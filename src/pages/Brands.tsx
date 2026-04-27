import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  last_month_gmv: number;
  tier_unlimited: boolean;
  tier_value: number | null;
  created_at: string;
}
interface ClientLite { id: string; name: string; }

const empty = {
  name: '',
  client_id: '',
  last_month_gmv: '',
  tier_unlimited: false,
  tier_value: '',
};

export default function Brands() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApcEditor = profile?.role === 'apc' && !!profile?.can_edit_brands;
  const canEditAny = isBob || isApcEditor;
  const [brands, setBrands] = useState<Brand[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [b, c] = await Promise.all([
      supabase.from('brands').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name').order('name'),
    ]);
    if (b.error || c.error) setErr((b.error ?? c.error)!.message);
    else { setBrands((b.data as Brand[]) ?? []); setClients((c.data as ClientLite[]) ?? []); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditId(null);
    setForm({ ...empty });
    setShow(true);
  };

  const openEdit = (b: Brand) => {
    setEditId(b.id);
    setForm({
      name: b.name,
      client_id: b.client_id ?? '',
      last_month_gmv: String(b.last_month_gmv ?? ''),
      tier_unlimited: b.tier_unlimited,
      tier_value: b.tier_value != null ? String(b.tier_value) : '',
    });
    setShow(true);
  };

  const remove = async (b: Brand) => {
    if (!confirm(`Delete brand "${b.name}"?`)) return;
    const prev = brands;
    setBrands(brands.filter(x => x.id !== b.id));
    const { error } = await supabase.from('brands').delete().eq('id', b.id);
    if (error) { alert(error.message); setBrands(prev); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const clientName = clients.find(c => c.id === form.client_id)?.name ?? '';
    const payload = {
      name: form.name.trim(),
      client_id: form.client_id || null,
      client: clientName,
      last_month_gmv: Number(form.last_month_gmv) || 0,
      tier_unlimited: form.tier_unlimited,
      tier_value: form.tier_unlimited ? null : (form.tier_value ? Number(form.tier_value) : null),
    };
    const res = editId
      ? await supabase.from('brands').update(payload).eq('id', editId)
      : await supabase.from('brands').insert(payload);
    setSaving(false);
    if (res.error) setErr(res.error.message);
    else { setShow(false); load(); }
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">Brands</h2>
        {isBob && (
          <Button onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" /> Add Brand
          </Button>
        )}
      </div>

      <Card>
        <Card.Body>
          {loading ? (
            <div className="text-center py-4"><Spinner animation="border" /></div>
          ) : err ? (
            <Alert variant="danger">{err}</Alert>
          ) : brands.length === 0 ? (
            <p className="text-muted mb-0 text-center py-4">No brands yet. Add your first one.</p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Client</th>
                  <th>GMV (Last 30 Days)</th>
                  <th>Tier</th>
                  {canEditAny && <th style={{ width: 140 }}></th>}
                </tr>
              </thead>
              <tbody>
                {brands.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/brands/${b.id}`)}>
                    <td className="fw-semibold">
                      {b.name}
                      <i className="bi bi-arrow-right-short ms-1 text-muted" />
                    </td>
                    <td>{b.client}</td>
                    <td>${Number(b.last_month_gmv).toLocaleString()}</td>
                    <td>
                      {b.tier_unlimited
                        ? <Badge bg="success">Unlimited</Badge>
                        : <Badge bg="secondary">{b.tier_value ?? '—'}</Badge>}
                    </td>
                    {canEditAny && (
                      <td className="text-end" onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="outline-primary" className="me-2" onClick={() => openEdit(b)} title="Edit brand">
                          <i className="bi bi-pencil" />
                        </Button>
                        {isBob && (
                          <Button size="sm" variant="outline-danger" onClick={() => remove(b)} title="Delete brand">
                            <i className="bi bi-trash" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editId ? 'Edit Brand' : 'Add Brand'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Brand name</Form.Label>
              <Form.Control required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Client</Form.Label>
              <Form.Select required value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">— Choose client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
              {clients.length === 0 && (
                <Form.Text className="text-muted">No clients yet — go to Clients menu and add one first.</Form.Text>
              )}
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>GMV (Last 30 Days) ($)</Form.Label>
              <Form.Control type="number" min={0} step="0.01" value={form.last_month_gmv}
                onChange={e => setForm({ ...form, last_month_gmv: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Check
                type="switch"
                id="tier-unlimited"
                label="Unlimited tier"
                checked={form.tier_unlimited}
                onChange={e => setForm({ ...form, tier_unlimited: e.target.checked })}
              />
            </Form.Group>
            {!form.tier_unlimited && (
              <Form.Group className="mb-3">
                <Form.Label>Tier value</Form.Label>
                <Form.Control type="number" min={0} placeholder="e.g. 2000"
                  value={form.tier_value}
                  onChange={e => setForm({ ...form, tier_value: e.target.value })} />
              </Form.Group>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editId ? 'Save' : 'Create')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
