import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';

interface Client {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  avatar_url?: string | null;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function PaidCollabClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[] });
  const [saving, setSaving] = useState(false);

  const [pwClient, setPwClient] = useState<Client | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delClient, setDelClient] = useState<Client | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: cRows, error: e1 }, { data: brandRows, error: e2 }, { data: assigns, error: e3 }] = await Promise.all([
      supabase.from('profiles').select('id,email,full_name,role,created_at,avatar_url').eq('role', 'paid_collab_client').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').contains('scope', ['paid_creator']).order('name'),
      supabase.from('paid_collab_client_brands').select('client_id,brand_id'),
    ]);
    if (e1 || e2 || e3) {
      setErr((e1 ?? e2 ?? e3)!.message);
      setLoading(false); return;
    }
    const brandMap = new Map<string,string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.client_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.client_id, arr);
    });
    setBrands(brandRows ?? []);
    setClients((cRows ?? []).map(c => ({
      ...c,
      brand_ids: assignMap.get(c.id) ?? [],
      brand_names: (assignMap.get(c.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.trim().toLowerCase();
    return clients.filter(c =>
      `${c.full_name ?? ''} ${c.email} ${(c.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const totalAssignments = clients.reduce((s, c) => s + (c.brand_ids?.length ?? 0), 0);

  const openAdd = () => {
    setEditClient(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [] });
    setErr(null);
    setShow(true);
  };

  const openEdit = (c: Client) => {
    setEditClient(c);
    setForm({ email: c.email, password: '', full_name: c.full_name ?? '', brand_ids: c.brand_ids ?? [] });
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
      if (editClient) {
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name }).eq('id', editClient.id);
        if (pErr) throw pErr;
        const { error: dErr } = await supabase.from('paid_collab_client_brands').delete().eq('client_id', editClient.id);
        if (dErr) throw dErr;
        if (form.brand_ids.length > 0) {
          const rows = form.brand_ids.map(bid => ({ client_id: editClient.id, brand_id: bid }));
          const { error: iErr } = await supabase.from('paid_collab_client_brands').insert(rows);
          if (iErr) throw iErr;
        }
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-paid-collab-client', {
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
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Paid Collab Clients</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{clients.length}</span>
            <span className="ac-stat-label">client{clients.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add Client
        </Button>
      </div>

      <Alert variant="light" className="border small">
        <i className="bi bi-info-circle me-1" />
        Paid Collab Clients only see the <strong>Paid Collab</strong> dashboard for the brands you assign them.
        They cannot see weekly or monthly reports, GMV Max, or any other Brand Detail tabs.
      </Alert>

      {clients.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input
            placeholder="Search by name, email, or brand…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="btn btn-link p-0 text-muted" onClick={() => setSearch('')}>
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err && clients.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : clients.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-people" /></div>
              <h5>No Paid Collab Clients yet</h5>
              <p>Add your first client. They'll be able to sign in and see the Paid Collab dashboard for the brands you assign.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Client
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No clients match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredClients.map(c => {
            const display = c.full_name || c.email;
            return (
              <div className="ac-list-row" key={c.id}>
                <Avatar name={display} src={c.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{c.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{c.email}</span>
                    <span className="ac-chip" title="Paid Collab Client role">
                      <i className="bi bi-people-fill" /> Paid Collab Client
                    </span>
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {(c.brand_names ?? []).length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : c.brand_names!.map(n => (
                      <span key={n} className="ac-chip neutral">
                        <i className="bi bi-shop" /> {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwClient(c); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(c)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn danger"
                    onClick={() => { setDelClient(c); setDelErr(null); }} title="Delete client">
                    <i className="bi bi-trash" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editClient ? 'Edit Paid Collab Client' : 'Add Paid Collab Client'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editClient} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editClient && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editClient && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the client.</Form.Text>
              </Form.Group>
            )}

            <Form.Group className="mb-2">
              <Form.Label>Assign brands</Form.Label>
              {brands.length === 0 ? (
                <p className="text-muted small mb-0">No paid-collab-enabled brands yet. Turn on “Enable paid collab” for a brand on the Brands page.</p>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                  {brands.map(b => (
                    <Form.Check
                      key={b.id}
                      type="checkbox"
                      id={`pcb-${b.id}`}
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
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editClient ? 'Save' : 'Create Client')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwClient} onHide={() => setPwClient(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwClient) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-paid-collab-client-password', {
              body: { user_id: pwClient.id, password: newPw },
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
            <Modal.Title>Reset password — {pwClient?.full_name || pwClient?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the client.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. afflix-2026" autoFocus />
              <Form.Text className="text-muted">The client can use this to sign in immediately. Copy it and send it to them manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwClient(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delClient} onHide={() => !delBusy && setDelClient(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete client?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delClient?.full_name || delClient?.email}</strong> and revoke their access. Their brand assignments will be cleared.</p>
          <p className="text-muted small mb-0">Any Paid Collab data they entered will remain. This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelClient(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delClient) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-paid-collab-client', {
                body: { user_id: delClient.id },
              });
              if (error) throw error;
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelClient(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete client');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete client'}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
