import { useEffect, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';

interface Client { id: string; name: string; created_at: string; brands?: { id: string; name: string }[]; }

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: cls, error: e1 }, { data: brs, error: e2 }] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('brands').select('id,name,client_id'),
    ]);
    if (e1 || e2) { setErr((e1 ?? e2)!.message); setLoading(false); return; }
    const map = new Map<string, { id: string; name: string }[]>();
    (brs ?? []).forEach((b: any) => {
      if (!b.client_id) return;
      const arr = map.get(b.client_id) ?? [];
      arr.push({ id: b.id, name: b.name });
      map.set(b.client_id, arr);
    });
    setClients((cls ?? []).map(c => ({ ...c, brands: map.get(c.id) ?? [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); setName(''); setErr(null); setShow(true); };
  const openEdit = (c: Client) => { setEditing(c); setName(c.name); setErr(null); setShow(true); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const res = editing
      ? await supabase.from('clients').update({ name: name.trim() }).eq('id', editing.id)
      : await supabase.from('clients').insert({ name: name.trim() });
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    setShow(false); load();
  };

  const remove = async (c: Client) => {
    if (!confirm(`Delete client "${c.name}"? Brands will be unlinked.`)) return;
    const { error } = await supabase.from('clients').delete().eq('id', c.id);
    if (error) alert(error.message); else load();
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Clients</h2>
        <Button onClick={openAdd}><i className="bi bi-plus-lg me-1" /> Add Client</Button>
      </div>

      <Card>
        <Card.Body>
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <Alert variant="danger">{err}</Alert>
            : clients.length === 0 ? <p className="text-muted text-center mb-0 py-4">No clients yet.</p>
            : (
              <Table hover responsive className="align-middle mb-0">
                <thead><tr><th>Client</th><th>Brands</th><th style={{width:140}}></th></tr></thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id}>
                      <td className="fw-semibold">{c.name}</td>
                      <td>
                        {(c.brands ?? []).length === 0
                          ? <span className="text-muted small">None</span>
                          : c.brands!.map(b => <Badge key={b.id} bg="info" className="me-1">{b.name}</Badge>)}
                      </td>
                      <td className="text-end">
                        <Button size="sm" variant="outline-primary" className="me-2" onClick={() => openEdit(c)}><i className="bi bi-pencil" /></Button>
                        <Button size="sm" variant="outline-danger" onClick={() => remove(c)}><i className="bi bi-trash" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton><Modal.Title>{editing ? 'Edit Client' : 'Add Client'}</Modal.Title></Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group>
              <Form.Label>Client name</Form.Label>
              <Form.Control required value={name} onChange={e => setName(e.target.value)} />
            </Form.Group>
            <Form.Text className="text-muted">After creating the client, edit any brand to assign it to this client.</Form.Text>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Create')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
