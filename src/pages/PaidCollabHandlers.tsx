import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import Avatar from '../components/Avatar';

interface Handler {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  avatar_url?: string | null;
  is_internal_handler?: boolean;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function PaidCollabHandlers() {
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editHandler, setEditHandler] = useState<Handler | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[], is_internal: false });
  const [brandSearch, setBrandSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const [pwHandler, setPwHandler] = useState<Handler | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delHandler, setDelHandler] = useState<Handler | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: hRows, error: e1 }, { data: brandRows, error: e2 }, { data: assigns, error: e3 }] = await Promise.all([
      supabase.from('profiles').select('id,email,full_name,role,created_at,avatar_url,is_internal_handler').eq('role', 'paid_collab_handler').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('paid_collab_handler_brands').select('handler_id,brand_id'),
    ]);
    if (e1 || e2 || e3) {
      setErr((e1 ?? e2 ?? e3)!.message);
      setLoading(false); return;
    }
    const brandMap = new Map<string,string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.handler_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.handler_id, arr);
    });
    setBrands(brandRows ?? []);
    setHandlers((hRows ?? []).map(h => ({
      ...h,
      brand_ids: assignMap.get(h.id) ?? [],
      brand_names: (assignMap.get(h.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredHandlers = useMemo(() => {
    if (!search.trim()) return handlers;
    const q = search.trim().toLowerCase();
    return handlers.filter(h =>
      `${h.full_name ?? ''} ${h.email} ${(h.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [handlers, search]);

  const totalAssignments = handlers.reduce((s, h) => s + (h.brand_ids?.length ?? 0), 0);

  const openAdd = () => {
    setEditHandler(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [], is_internal: false });
    setBrandSearch('');
    setErr(null);
    setShow(true);
  };

  const openEdit = (h: Handler) => {
    setEditHandler(h);
    setForm({ email: h.email, password: '', full_name: h.full_name ?? '', brand_ids: h.brand_ids ?? [], is_internal: !!h.is_internal_handler });
    setBrandSearch('');
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
      if (editHandler) {
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name, is_internal_handler: form.is_internal }).eq('id', editHandler.id);
        if (pErr) throw pErr;
        const { error: dErr } = await supabase.from('paid_collab_handler_brands').delete().eq('handler_id', editHandler.id);
        if (dErr) throw dErr;
        if (form.brand_ids.length > 0) {
          const rows = form.brand_ids.map(bid => ({ handler_id: editHandler.id, brand_id: bid }));
          const { error: iErr } = await supabase.from('paid_collab_handler_brands').insert(rows);
          if (iErr) throw iErr;
        }
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-paid-collab-handler', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: form.brand_ids,
            is_internal: form.is_internal,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw await fnError(error);
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
          <h2>Paid Collab Handlers</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{handlers.length}</span>
            <span className="ac-stat-label">handler{handlers.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add Handler
        </Button>
      </div>

      <Alert variant="light" className="border small">
        <i className="bi bi-info-circle me-1" />
        Paid Collab Handlers are ops staff who manage day-to-day paid collab data — creators, videos, programs — for the brands you assign them.
        They don't see weekly/monthly reports, GMV Max, or other Brand Detail tabs.
        Handlers marked <strong>Internal</strong> additionally get team Chats and Tasks (you can assign them tasks; they can assign tasks to APCs).
      </Alert>

      {handlers.length > 0 && (
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
      ) : err && handlers.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : handlers.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-person-gear" /></div>
              <h5>No Paid Collab Handlers yet</h5>
              <p>Add your first handler. They'll be able to sign in and manage paid collab data for the brands you assign.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Handler
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredHandlers.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No handlers match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredHandlers.map(h => {
            const display = h.full_name || h.email;
            return (
              <div className="ac-list-row" key={h.id}>
                <Avatar name={display} src={h.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{h.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{h.email}</span>
                    <span className="ac-chip" title="Paid Collab Handler role">
                      <i className="bi bi-person-gear" /> Paid Collab Handler
                    </span>
                    {h.is_internal_handler ? (
                      <span className="ac-chip" style={{ color: '#16a34a', borderColor: '#16a34a' }}
                        title="Internal — has team Chats and Tasks access">
                        <i className="bi bi-people-fill" /> Internal
                      </span>
                    ) : (
                      <span className="ac-chip neutral" title="External — paid collab workspace only">
                        <i className="bi bi-box-arrow-up-right" /> External
                      </span>
                    )}
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {(h.brand_names ?? []).length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : (
                      <>
                        <span className="ac-chip" title="Brands assigned">
                          <i className="bi bi-shop" /> {h.brand_names!.length} brand{h.brand_names!.length === 1 ? '' : 's'}
                        </span>
                        {h.brand_names!.map(n => (
                          <span key={n} className="ac-chip neutral">
                            <i className="bi bi-shop" /> {n}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwHandler(h); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(h)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn danger"
                    onClick={() => { setDelHandler(h); setDelErr(null); }} title="Delete handler">
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
            <Modal.Title>{editHandler ? 'Edit Paid Collab Handler' : 'Add Paid Collab Handler'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editHandler} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editHandler && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editHandler && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the handler.</Form.Text>
              </Form.Group>
            )}

            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="pch-internal"
                label={<><strong>Internal handler</strong> <span className="text-muted">— part of the team</span></>}
                checked={form.is_internal}
                onChange={e => setForm({ ...form, is_internal: e.target.checked })}
              />
              <Form.Text className="text-muted">
                {form.is_internal
                  ? 'Gets access to team Chats and Tasks — can be assigned tasks by you and can assign tasks to any APC.'
                  : 'External (default) — paid collab workspace only, no Chats or Tasks.'}
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-2">
              <div className="d-flex align-items-center justify-content-between mb-1">
                <Form.Label className="mb-0">Assign brands</Form.Label>
                <span className="text-muted small">
                  {form.brand_ids.length} of {brands.length} selected
                </span>
              </div>
              {brands.length === 0 ? (
                <p className="text-muted small mb-0">No brands yet. Create a brand on the Brands page.</p>
              ) : (() => {
                const q = brandSearch.trim().toLowerCase();
                const visible = q ? brands.filter(b => b.name.toLowerCase().includes(q)) : brands;
                return (
                  <>
                    <div className="ac-search mb-2">
                      <i className="bi bi-search" />
                      <input
                        placeholder="Search brands…"
                        value={brandSearch}
                        onChange={e => setBrandSearch(e.target.value)}
                      />
                      {brandSearch && (
                        <button type="button" className="btn btn-link p-0 text-muted" onClick={() => setBrandSearch('')}>
                          <i className="bi bi-x-lg" />
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                      {visible.length === 0 ? (
                        <p className="text-muted small mb-0">No brands match “{brandSearch}”.</p>
                      ) : visible.map(b => (
                        <Form.Check
                          key={b.id}
                          type="checkbox"
                          id={`pch-${b.id}`}
                          label={b.name}
                          checked={form.brand_ids.includes(b.id)}
                          onChange={() => toggleBrand(b.id)}
                        />
                      ))}
                    </div>
                  </>
                );
              })()}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editHandler ? 'Save' : 'Create Handler')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwHandler} onHide={() => setPwHandler(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwHandler) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-paid-collab-handler-password', {
              body: { user_id: pwHandler.id, password: newPw },
            });
            if (error) throw await fnError(error);
            if ((data as any)?.error) throw new Error((data as any).error);
            setPwOk(true);
          } catch (e: any) {
            setPwErr(e?.message ?? 'Failed to reset password');
          } finally {
            setPwBusy(false);
          }
        }}>
          <Modal.Header closeButton>
            <Modal.Title>Reset password — {pwHandler?.full_name || pwHandler?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the handler.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. afflix-2026" autoFocus />
              <Form.Text className="text-muted">The handler can use this to sign in immediately. Copy it and send it to them manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwHandler(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delHandler} onHide={() => !delBusy && setDelHandler(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete handler?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delHandler?.full_name || delHandler?.email}</strong> and revoke their access. Their brand assignments will be cleared.</p>
          <p className="text-muted small mb-0">Any data they entered will remain. This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelHandler(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delHandler) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-paid-collab-handler', {
                body: { user_id: delHandler.id },
              });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelHandler(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete handler');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete handler'}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
