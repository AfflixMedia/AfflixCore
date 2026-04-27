import { useEffect, useState, FormEvent } from 'react';
import { Card, Button, Modal, Form, Row, Col, Alert, Badge, Spinner, InputGroup } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { resourceIcon } from '../../lib/resourceIcon';

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

export default function BrandResourcesTab({ brandId, brandName }: { brandId: string; brandName: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.from('resources').select('*')
      .eq('brand_id', brandId).order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setItems((data as Resource[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [brandId]);

  const filtered = items.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${r.name} ${r.url} ${r.description ?? ''}`.toLowerCase().includes(q);
  });

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', url: '', description: '' });
    setErr(null); setShow(true);
  };
  const openEdit = (r: Resource) => {
    setEditing(r);
    setForm({ name: r.name, url: r.url.replace(/^https?:\/\//, ''), description: r.description ?? '' });
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
      scope: 'brand' as const,
      brand_id: brandId,
      created_by: user?.id,
    };
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

  return (
    <>
      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-center">
            <Col md>
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control placeholder={`Search resources for ${brandName}…`}
                  value={search} onChange={e => setSearch(e.target.value)} />
                {search && (
                  <Button variant="outline-secondary" onClick={() => setSearch('')}>
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </InputGroup>
            </Col>
            <Col md="auto">
              <Button onClick={openAdd}>
                <i className="bi bi-plus-lg me-1" /> Add Resource
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
        : err ? <Alert variant="danger">{err}</Alert>
        : filtered.length === 0 ? (
          <Card body className="text-center text-muted">
            {search ? 'No resources match your search.' : `No resources for ${brandName} yet — add one above.`}
          </Card>
        ) : (
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
                        <Badge bg="info">{brandName}</Badge>
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

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit resource' : 'Add resource'} — {brandName}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">Resource name</Form.Label>
              <Form.Control required placeholder="e.g. Q2 Brand Guidelines"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">URL</Form.Label>
              <InputGroup>
                <InputGroup.Text>https://</InputGroup.Text>
                <Form.Control required placeholder="notion.so/brand-guide"
                  value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
              </InputGroup>
            </Form.Group>
            <Form.Group>
              <Form.Label className="fw-semibold">Description</Form.Label>
              <Form.Control as="textarea" rows={3} maxLength={DESC_MAX}
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              <div className="text-end small text-muted mt-1">{form.description.length} / {DESC_MAX}</div>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add resource')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
