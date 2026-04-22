import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge, InputGroup } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface Client { id: string; name: string; }
interface Brand  { id: string; name: string; client_id: string | null; }
interface Link {
  id: string; token: string; label: string | null; client_id: string;
  brand_ids: string[]; created_at: string; revoked_at: string | null;
}

export default function ClientAccess() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [clientId, setClientId] = useState('');
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [c, b, l] = await Promise.all([
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('brands').select('id,name,client_id').order('name'),
      supabase.from('report_share_links').select('*').order('created_at', { ascending: false }),
    ]);
    const e = c.error ?? b.error ?? l.error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setClients(c.data ?? []);
    setBrands(b.data ?? []);
    setLinks((l.data as Link[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const brandMap  = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands]);
  const brandsForClient = useMemo(
    () => brands.filter(b => b.client_id === clientId),
    [brands, clientId],
  );

  const openAdd = () => {
    setClientId(''); setBrandIds([]); setLabel(''); setErr(null); setShow(true);
  };

  const toggle = (id: string) => {
    setBrandIds(arr => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    if (brandIds.length === 0) { setErr('Pick at least one brand'); setSaving(false); return; }
    const token = generateToken();
    const { error } = await supabase.from('report_share_links').insert({
      token, label: label.trim() || null, client_id: clientId, brand_ids: brandIds, created_by: user?.id,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setShow(false); load();
  };

  const revoke = async (l: Link) => {
    if (!confirm('Revoke this link? Anyone using it will lose access.')) return;
    const { error } = await supabase.from('report_share_links')
      .update({ revoked_at: new Date().toISOString() }).eq('id', l.id);
    if (error) alert(error.message); else load();
  };

  const reactivate = async (l: Link) => {
    const { error } = await supabase.from('report_share_links')
      .update({ revoked_at: null }).eq('id', l.id);
    if (error) alert(error.message); else load();
  };

  const remove = async (l: Link) => {
    if (!confirm('Delete this link permanently?')) return;
    const { error } = await supabase.from('report_share_links').delete().eq('id', l.id);
    if (error) alert(error.message); else load();
  };

  const linkUrl = (token: string) => `${window.location.origin}/share/${token}`;

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Client Access</h2>
        <Button onClick={openAdd}><i className="bi bi-link-45deg me-1" /> Create Share Link</Button>
      </div>

      <Card>
        <Card.Body>
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <Alert variant="danger">{err}</Alert>
            : links.length === 0 ? <p className="text-muted text-center mb-0 py-4">No share links yet.</p>
            : (
              <Table hover responsive className="align-middle mb-0">
                <thead><tr>
                  <th>Label</th><th>Client</th><th>Brands</th><th>URL</th><th>Status</th><th style={{width:160}}></th>
                </tr></thead>
                <tbody>
                  {links.map(l => {
                    const cl = clientMap.get(l.client_id);
                    return (
                      <tr key={l.id}>
                        <td className="fw-semibold">{l.label || '—'}</td>
                        <td>{cl?.name ?? '—'}</td>
                        <td>
                          {l.brand_ids.map(id => (
                            <Badge key={id} bg="info" className="me-1">{brandMap.get(id)?.name ?? '?'}</Badge>
                          ))}
                        </td>
                        <td>
                          <InputGroup size="sm">
                            <Form.Control readOnly value={linkUrl(l.token)} onFocus={e => (e.target as HTMLInputElement).select()} />
                            <Button variant="outline-secondary" onClick={() => { navigator.clipboard.writeText(linkUrl(l.token)); }}>
                              <i className="bi bi-clipboard" />
                            </Button>
                            <Button variant="outline-secondary" onClick={() => window.open(linkUrl(l.token), '_blank')}>
                              <i className="bi bi-box-arrow-up-right" />
                            </Button>
                          </InputGroup>
                        </td>
                        <td>
                          {l.revoked_at
                            ? <Badge bg="danger">Revoked</Badge>
                            : <Badge bg="success">Active</Badge>}
                        </td>
                        <td className="text-end">
                          {l.revoked_at
                            ? <Button size="sm" variant="outline-success" className="me-2" onClick={() => reactivate(l)}>Reactivate</Button>
                            : <Button size="sm" variant="outline-warning" className="me-2" onClick={() => revoke(l)}>Revoke</Button>}
                          <Button size="sm" variant="outline-danger" onClick={() => remove(l)}><i className="bi bi-trash" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton><Modal.Title>Create Share Link</Modal.Title></Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Label (internal note)</Form.Label>
              <Form.Control value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Q2 review for Acme" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Client</Form.Label>
              <Form.Select required value={clientId} onChange={e => { setClientId(e.target.value); setBrandIds([]); }}>
                <option value="">— Choose client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </Form.Group>
            {clientId && (
              <Form.Group>
                <Form.Label>Brands to share</Form.Label>
                {brandsForClient.length === 0 ? (
                  <p className="text-muted small mb-0">No brands linked to this client yet. Edit a brand and assign this client first.</p>
                ) : (
                  <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                    {brandsForClient.map(b => (
                      <Form.Check key={b.id} type="checkbox" id={`b-${b.id}`} label={b.name}
                        checked={brandIds.includes(b.id)} onChange={() => toggle(b.id)} />
                    ))}
                  </div>
                )}
              </Form.Group>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving || !clientId || brandIds.length === 0}>
              {saving ? 'Creating…' : 'Create link'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
