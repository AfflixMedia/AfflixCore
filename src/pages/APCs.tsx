import { useEffect, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';

interface APC {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function APCs() {
  const [apcs, setApcs] = useState<APC[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [editApc, setEditApc] = useState<APC | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[] });
  const [saving, setSaving] = useState(false);

  const [pwApc, setPwApc] = useState<APC | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: apcRows, error: e1 }, { data: brandRows, error: e2 }, { data: assigns, error: e3 }] = await Promise.all([
      supabase.from('profiles').select('id,email,full_name,role,created_at').eq('role', 'apc').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('apc_brands').select('apc_id,brand_id'),
    ]);
    if (e1 || e2 || e3) {
      setErr((e1 ?? e2 ?? e3)!.message);
      setLoading(false); return;
    }
    const brandMap = new Map<string,string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.apc_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.apc_id, arr);
    });
    setBrands(brandRows ?? []);
    setApcs((apcRows ?? []).map(a => ({
      ...a,
      brand_ids: assignMap.get(a.id) ?? [],
      brand_names: (assignMap.get(a.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditApc(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [] });
    setErr(null);
    setShow(true);
  };

  const openEdit = (a: APC) => {
    setEditApc(a);
    setForm({ email: a.email, password: '', full_name: a.full_name ?? '', brand_ids: a.brand_ids ?? [] });
    setErr(null);
    setShow(true);
  };

  const toggleBrand = (id: string) => {
    setForm(f => ({
      ...f,
      brand_ids: f.brand_ids.includes(id) ? f.brand_ids.filter(b => b !== id) : [...f.brand_ids, id],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      if (editApc) {
        // Update name + reassign brands (cannot change email/password here)
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name }).eq('id', editApc.id);
        if (pErr) throw pErr;
        const { error: dErr } = await supabase.from('apc_brands').delete().eq('apc_id', editApc.id);
        if (dErr) throw dErr;
        if (form.brand_ids.length > 0) {
          const rows = form.brand_ids.map(bid => ({ apc_id: editApc.id, brand_id: bid }));
          const { error: iErr } = await supabase.from('apc_brands').insert(rows);
          if (iErr) throw iErr;
        }
      } else {
        // Call edge function to create user
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-apc', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: form.brand_ids,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
      }
      setShow(false);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2 className="mb-0">APCs</h2>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add APC
        </Button>
      </div>

      <Card>
        <Card.Body>
          {loading ? (
            <div className="text-center py-4"><Spinner animation="border" /></div>
          ) : err && apcs.length === 0 ? (
            <Alert variant="danger">{err}</Alert>
          ) : apcs.length === 0 ? (
            <p className="text-muted mb-0 text-center py-4">No APCs yet. Add your first one.</p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Assign Brands</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {apcs.map(a => (
                  <tr key={a.id}>
                    <td className="fw-semibold">{a.full_name || '—'}</td>
                    <td>{a.email}</td>
                    <td>
                      {(a.brand_names ?? []).length === 0
                        ? <span className="text-muted">None</span>
                        : a.brand_names!.map(n => <Badge key={n} bg="info" className="me-1">{n}</Badge>)}
                    </td>
                    <td className="text-end">
                      <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => { setPwApc(a); setNewPw(''); setPwErr(null); setPwOk(false); }}
                        title="Reset password">
                        <i className="bi bi-key" />
                      </Button>
                      <Button size="sm" variant="outline-primary" onClick={() => openEdit(a)}>
                        <i className="bi bi-pencil" />
                      </Button>
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
          <Modal.Header closeButton>
            <Modal.Title>{editApc ? 'Edit APC' : 'Add APC'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editApc} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editApc && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editApc && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the APC.</Form.Text>
              </Form.Group>
            )}
            <Form.Group className="mb-2">
              <Form.Label>Assign brands</Form.Label>
              {brands.length === 0 ? (
                <p className="text-muted small mb-0">No brands exist yet. Create some first.</p>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                  {brands.map(b => (
                    <Form.Check
                      key={b.id}
                      type="checkbox"
                      id={`b-${b.id}`}
                      label={b.name}
                      checked={form.brand_ids.includes(b.id)}
                      onChange={() => toggleBrand(b.id)}
                    />
                  ))}
                </div>
              )}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editApc ? 'Save' : 'Create APC')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwApc} onHide={() => setPwApc(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwApc) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-apc-password', {
              body: { user_id: pwApc.id, password: newPw },
            });
            if (error) throw error;
            if ((data as any)?.error) throw new Error((data as any).error);
            setPwOk(true);
          } catch (e: any) {
            setPwErr(e?.message ?? 'Failed to reset password');
          } finally {
            setPwBusy(false);
          }
        }}>
          <Modal.Header closeButton>
            <Modal.Title>Reset password — {pwApc?.full_name || pwApc?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the APC.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. afflix-2026" autoFocus />
              <Form.Text className="text-muted">The APC can use this to sign in immediately. Copy it and send it to them manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwApc(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
