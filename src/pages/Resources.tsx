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

export default function Resources() {
  const { user } = useAuth();
  const [items, setItems] = useState<Resource[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '', scope: 'general' as 'general' | 'brand', brand_id: '' });
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [filterBrand, setFilterBrand] = useState('');

  const load = async () => {
    setLoading(true); setErr(null);
    const [r, b] = await Promise.all([
      supabase.from('resources').select('*').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').order('name'),
    ]);
    if (r.error || b.error) setErr((r.error ?? b.error)!.message);
    else { setItems((r.data as Resource[]) ?? []); setBrands((b.data as BrandLite[]) ?? []); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const brandMap = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);

  const filtered = useMemo(() => items.filter(r => {
    if (filterBrand === '__general') { if (r.scope !== 'general') return false; }
    else if (filterBrand) { if (r.brand_id !== filterBrand) return false; }
    if (search) {
      const q = search.toLowerCase();
      if (!(`${r.name} ${r.url} ${r.description ?? ''}`.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [items, filterBrand, search]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', url: '', description: '', scope: 'general', brand_id: '' });
    setErr(null); setShow(true);
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
    const { error } = await supabase.from('resources').delete().eq('id', r.id);
    if (error) alert(error.message); else load();
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Resources</h2>
        <Button onClick={openAdd}><i className="bi bi-plus-lg me-1" /> Add Resource</Button>
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-end">
            <Col md={5}>
              <Form.Control size="sm" placeholder="Search by name, URL, description…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </Col>
            <Col md={4}>
              <Form.Select size="sm" value={filterBrand} onChange={e => setFilterBrand(e.target.value)}>
                <option value="">All scopes</option>
                <option value="__general">General only</option>
                <optgroup label="By brand">
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </optgroup>
              </Form.Select>
            </Col>
            <Col md={3} className="text-end text-muted small">
              {filtered.length} resource{filtered.length !== 1 ? 's' : ''}
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {loading ? <div className="text-center py-5"><Spinner animation="border" /></div>
        : err ? <Alert variant="danger">{err}</Alert>
        : filtered.length === 0 ? (
            <Card body className="text-center text-muted">No resources yet.</Card>
          )
        : (
          <Row className="g-3">
            {filtered.map(r => {
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
                        <div>
                          <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => openEdit(r)}>
                            <i className="bi bi-pencil" />
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => remove(r)}>
                            <i className="bi bi-trash" />
                          </Button>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>
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

            {form.scope === 'brand' && (
              <Form.Group>
                <Form.Label className="small">Which brand?</Form.Label>
                <Form.Select required value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })}>
                  <option value="">— Choose brand —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
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
