import { useEffect, useState, FormEvent, useMemo } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Badge, Row, Col, InputGroup } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { resourceIcon } from '../lib/resourceIcon';

interface BrandLite { id: string; name: string; }
interface Resource {
  id: string;
  name: string;
  url: string;
  description: string | null;
  scope: 'general' | 'brand';
  brand_id: string | null;
  created_at: string;
}

const DESC_MAX = 240;
const GENERAL_KEY = '__general__';

type FolderKey = string; // brand id, or GENERAL_KEY

function brandColor(id: string) {
  // deterministic pastel from id
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 65% 50%)`;
}

function brandInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export default function Resources() {
  const { user, profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApc = profile?.role === 'apc';
  const [items, setItems] = useState<Resource[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '', scope: 'general' as 'general' | 'brand', brand_id: '' });
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [openFolder, setOpenFolder] = useState<FolderKey | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const [r, b] = await Promise.all([
      supabase.from('resources').select('*').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').order('name'),
    ]);
    setBrands((b.data as BrandLite[]) ?? []);
    setItems((r.data as Resource[]) ?? []);
    if (r.error && !r.error.message?.includes('does not exist')) setErr(r.error.message);
    else if (r.error) setErr('Run the resources SQL migration in Supabase (schema_resources.sql).');
    else if (b.error) setErr(b.error.message);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);

  // counts per folder
  const counts = useMemo(() => {
    const m = new Map<FolderKey, number>();
    items.forEach(r => {
      const key: FolderKey = r.scope === 'general' ? GENERAL_KEY : (r.brand_id ?? GENERAL_KEY);
      m.set(key, (m.get(key) ?? 0) + 1);
    });
    return m;
  }, [items]);

  const folderName = (key: FolderKey) => key === GENERAL_KEY ? 'General' : (brandMap.get(key) ?? 'Brand');

  const matches = (r: Resource, q: string) =>
    `${r.name} ${r.url} ${r.description ?? ''}`.toLowerCase().includes(q);

  // items visible given current folder + search
  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (openFolder !== null) {
      const inFolder = items.filter(r => {
        const k = r.scope === 'general' ? GENERAL_KEY : r.brand_id;
        return k === openFolder;
      });
      return q ? inFolder.filter(r => matches(r, q)) : inFolder;
    }
    // folder-grid mode: when searching, flatten across folders
    return q ? items.filter(r => matches(r, q)) : [];
  }, [items, openFolder, search]);

  // folders to show in grid (all brands user can see + general; brand-only if it has items OR always? show all so user can add into any brand)
  const folders = useMemo(() => {
    const list: { key: FolderKey; name: string; count: number; color: string }[] = [];
    list.push({ key: GENERAL_KEY, name: 'General', count: counts.get(GENERAL_KEY) ?? 0, color: '#64748b' });
    brands.forEach(b => {
      list.push({ key: b.id, name: b.name, count: counts.get(b.id) ?? 0, color: brandColor(b.id) });
    });
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(f => f.name.toLowerCase().includes(q) || f.count > 0);
  }, [brands, counts, search]);

  const openAdd = () => {
    setEditing(null);
    // APCs can only add brand-scoped resources for their brands
    if (isApc) {
      const defaultBrand = openFolder && openFolder !== GENERAL_KEY ? openFolder : (brands[0]?.id ?? '');
      setForm({ name: '', url: '', description: '', scope: 'brand', brand_id: defaultBrand });
    } else if (openFolder === GENERAL_KEY) {
      setForm({ name: '', url: '', description: '', scope: 'general', brand_id: '' });
    } else if (openFolder) {
      setForm({ name: '', url: '', description: '', scope: 'brand', brand_id: openFolder });
    } else {
      setForm({ name: '', url: '', description: '', scope: 'general', brand_id: '' });
    }
    setErr(null); setShow(true);
  };

  const canEditResource = (r: Resource) => {
    if (isBob) return true;
    if (isApc && r.scope === 'brand' && r.brand_id) {
      return brands.some(b => b.id === r.brand_id);
    }
    return false;
  };

  const openEdit = (r: Resource) => {
    setEditing(r);
    setForm({
      name: r.name,
      url: r.url.replace(/^https?:\/\//, ''),
      description: r.description ?? '',
      scope: r.scope,
      brand_id: r.brand_id ?? '',
    });
    setErr(null); setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const fullUrl = form.url.startsWith('http') ? form.url : `https://${form.url}`;
    const payload = {
      name: form.name.trim(),
      url: fullUrl.trim(),
      description: form.description.trim() || null,
      scope: form.scope,
      brand_id: form.scope === 'brand' ? (form.brand_id || null) : null,
      created_by: user?.id,
    };
    if (form.scope === 'brand' && !payload.brand_id) {
      setErr('Pick a brand or switch to General.'); setSaving(false); return;
    }
    const res = editing
      ? await supabase.from('resources').update(payload).eq('id', editing.id)
      : await supabase.from('resources').insert(payload);
    setSaving(false);
    if (res.error) setErr(res.error.message);
    else { setShow(false); load(); }
  };

  const remove = async (r: Resource) => {
    if (!confirm(`Delete resource "${r.name}"?`)) return;
    const prev = items;
    setItems(items.filter(x => x.id !== r.id));
    const { error } = await supabase.from('resources').delete().eq('id', r.id);
    if (error) { alert(error.message); setItems(prev); }
  };

  const inFolder = openFolder !== null;
  const searching = search.trim().length > 0;
  // modes:
  //  - inside folder (with optional search scope)
  //  - grid without search
  //  - grid with search -> show flattened result list AND matching folders above
  const showGridFolders = !inFolder;
  const showFlatItems = inFolder || (showGridFolders && searching);

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div className="d-flex align-items-center gap-2">
          {inFolder && (
            <Button size="sm" variant="outline-secondary" onClick={() => setOpenFolder(null)} title="Back to folders">
              <i className="bi bi-arrow-left" />
            </Button>
          )}
          <h2 className="mb-0">
            {inFolder ? (
              <>
                <span className="text-muted">Resources /</span>{' '}
                <span>{folderName(openFolder!)}</span>
              </>
            ) : 'Resources'}
          </h2>
        </div>
        <Button onClick={openAdd}><i className="bi bi-plus-lg me-1" /> Add Resource</Button>
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-center">
            <Col md={8}>
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control
                  placeholder={inFolder
                    ? `Search in ${folderName(openFolder!)}…`
                    : 'Search brands, resources, URLs…'}
                  value={search} onChange={e => setSearch(e.target.value)} />
                {search && (
                  <Button variant="outline-secondary" onClick={() => setSearch('')} title="Clear">
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </InputGroup>
            </Col>
            <Col md={4} className="text-end text-muted small">
              {inFolder
                ? `${visibleItems.length} resource${visibleItems.length !== 1 ? 's' : ''}`
                : searching
                  ? `${visibleItems.length} match${visibleItems.length !== 1 ? 'es' : ''} in ${folders.length} folder${folders.length !== 1 ? 's' : ''}`
                  : `${folders.length} folder${folders.length !== 1 ? 's' : ''} • ${items.length} resource${items.length !== 1 ? 's' : ''}`}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {loading ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : err ? <Alert variant="danger">{err}</Alert>
        : (
          <>
            {showGridFolders && (
              folders.length === 0 ? (
                <Card body className="text-center text-muted">No folders match your search.</Card>
              ) : (
                <Row className="g-3 mb-3">
                  {folders.map(f => (
                    <Col xs={6} md={4} lg={3} key={f.key}>
                      <Card
                        className="h-100 shadow-sm folder-card"
                        style={{ cursor: 'pointer', transition: 'transform .12s, box-shadow .12s' }}
                        onClick={() => { setOpenFolder(f.key); setSearch(''); }}
                      >
                        <Card.Body className="d-flex align-items-center gap-3">
                          <div
                            style={{
                              width: 52, height: 44, borderRadius: 8,
                              background: f.color,
                              color: 'white',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 700, fontSize: '0.95rem',
                              flexShrink: 0,
                              position: 'relative',
                            }}
                          >
                            {f.key === GENERAL_KEY
                              ? <i className="bi bi-globe" style={{ fontSize: '1.4rem' }} />
                              : brandInitials(f.name)}
                            <i className="bi bi-folder-fill" style={{
                              position: 'absolute', bottom: -6, right: -6,
                              background: 'white', borderRadius: '50%', padding: 2,
                              color: f.color, fontSize: '.8rem',
                              border: `1px solid ${f.color}`,
                            }} />
                          </div>
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold text-truncate">{f.name}</div>
                            <div className="text-muted small">
                              {f.count} resource{f.count !== 1 ? 's' : ''}
                            </div>
                          </div>
                          <i className="bi bi-chevron-right text-muted" />
                        </Card.Body>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )
            )}

            {showFlatItems && (
              visibleItems.length === 0 ? (
                <Card body className="text-center text-muted">
                  {searching
                    ? 'No resources match your search.'
                    : 'No resources in this folder yet. Click "Add Resource" to create one.'}
                </Card>
              ) : (
                <>
                  {showGridFolders && searching && (
                    <h6 className="text-muted text-uppercase small mt-4 mb-2">Matching resources</h6>
                  )}
                  <Row className="g-3">
                    {visibleItems.map(r => {
                      const ic = resourceIcon(r.url);
                      return (
                        <Col md={6} lg={4} key={r.id}>
                          <Card className="h-100 shadow-sm" style={{ borderLeft: `4px solid ${ic.color}` }}>
                            <Card.Body>
                              <div className="d-flex align-items-start justify-content-between mb-2">
                                <div style={{ fontSize: '1.8rem', color: ic.color, lineHeight: 1 }}>
                                  <i className={`bi ${ic.icon}`} />
                                </div>
                                <div className="text-end">
                                  {r.scope === 'general'
                                    ? <Badge bg="secondary">General</Badge>
                                    : <Badge bg="info">{brandMap.get(r.brand_id!) ?? 'Brand'}</Badge>}
                                </div>
                              </div>
                              <h6 className="mb-1">{r.name}</h6>
                              <div className="text-muted small text-truncate mb-2">
                                <i className="bi bi-link-45deg" /> {ic.label}
                              </div>
                              {r.description && <p className="small text-muted mb-2" style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>}
                              <div className="d-flex justify-content-between align-items-center mt-3">
                                <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                                  Open <i className="bi bi-box-arrow-up-right ms-1" />
                                </a>
                                {canEditResource(r) && (
                                  <div>
                                    <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => openEdit(r)}>
                                      <i className="bi bi-pencil" />
                                    </Button>
                                    <Button size="sm" variant="outline-danger" onClick={() => remove(r)}>
                                      <i className="bi bi-trash" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </Card.Body>
                          </Card>
                        </Col>
                      );
                    })}
                  </Row>
                </>
              )
            )}
          </>
        )}

      <Modal show={show} onHide={() => setShow(false)} centered size="lg">
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>
              <i className="bi bi-file-earmark-plus me-2" />
              {editing ? 'Edit resource' : 'Add resource'}
              <div className="text-muted small fw-normal mt-1">Share a link, doc, or tool with your team</div>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <div className="d-flex justify-content-between">
                <Form.Label className="fw-semibold mb-1">Resource name</Form.Label>
                <small className="text-danger fw-semibold">REQUIRED</small>
              </div>
              <Form.Control required placeholder="e.g. Q2 Brand Guidelines"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>

            <Form.Group className="mb-3">
              <div className="d-flex justify-content-between">
                <Form.Label className="fw-semibold mb-1">URL</Form.Label>
                <small className="text-muted">Must be reachable</small>
              </div>
              <InputGroup>
                <InputGroup.Text>https://</InputGroup.Text>
                <Form.Control required placeholder="notion.so/brand-guide"
                  value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
              </InputGroup>
            </Form.Group>

            <Form.Group className="mb-3">
              <div className="d-flex justify-content-between">
                <Form.Label className="fw-semibold mb-1">Description</Form.Label>
                <small className="text-muted">Optional</small>
              </div>
              <Form.Control as="textarea" rows={3} maxLength={DESC_MAX}
                placeholder="A short note so teammates know what this is for…"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
              <div className="text-end small text-muted mt-1">{form.description.length} / {DESC_MAX}</div>
            </Form.Group>

            {!isApc && (
              <Form.Group className="mb-2">
                <div className="d-flex justify-content-between">
                  <Form.Label className="fw-semibold mb-1">Scope</Form.Label>
                  <small className="text-muted">
                    {form.scope === 'general' ? 'Visible across the workspace' : 'Visible to users of this brand'}
                  </small>
                </div>
                <Row className="g-2">
                  <Col>
                    <ScopeOption
                      active={form.scope === 'brand'}
                      onClick={() => setForm({ ...form, scope: 'brand' })}
                      icon="bi-star"
                      title="Brand"
                      sub="Brand-specific"
                    />
                  </Col>
                  <Col>
                    <ScopeOption
                      active={form.scope === 'general'}
                      onClick={() => setForm({ ...form, scope: 'general', brand_id: '' })}
                      icon="bi-globe"
                      title="General"
                      sub="All brands"
                    />
                  </Col>
                </Row>
              </Form.Group>
            )}

            {form.scope === 'brand' && (
              <Form.Group>
                <Form.Label className="small">Which brand?</Form.Label>
                <Form.Select required value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">— Choose brand —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
                {isApc && (
                  <Form.Text className="text-muted">
                    APCs can add resources only for brands assigned to them.
                  </Form.Text>
                )}
              </Form.Group>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              <i className="bi bi-check2 me-1" />
              {saving ? 'Saving…' : (editing ? 'Save' : 'Add resource')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <style>{`
        .folder-card:hover { transform: translateY(-2px); box-shadow: 0 .5rem 1rem rgba(0,0,0,.08) !important; }
      `}</style>
    </>
  );
}

function ScopeOption({ active, onClick, icon, title, sub }: {
  active: boolean; onClick: () => void; icon: string; title: string; sub: string;
}) {
  return (
    <button type="button" onClick={onClick} className={`w-100 p-3 rounded border text-start ${active ? 'border-primary' : 'border-secondary-subtle'}`}
      style={{
        background: active ? 'rgba(37,99,235,.08)' : 'white',
        transition: 'all .15s',
        cursor: 'pointer',
      }}>
      <div className="d-flex align-items-center gap-2">
        <i className={`bi ${icon}`} style={{ fontSize: '1.2rem', color: active ? '#2563eb' : '#64748b' }} />
        <div>
          <div className="fw-semibold">{title}</div>
          <div className="text-muted small">{sub}</div>
        </div>
      </div>
    </button>
  );
}
