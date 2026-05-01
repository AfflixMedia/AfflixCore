import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  scope: string[];
  client_status: ClientStatus;
  shop_code: string | null;
  created_at: string;
}
interface ClientLite { id: string; name: string; }

type ClientStatus = 'active' | 'new_account' | 'inactive';

type ScopeKey = 'affiliate' | 'affiliate_limited' | 'ads' | 'paid_creator' | 'shop';

const SCOPE_OPTIONS: { key: ScopeKey; label: string; icon: string }[] = [
  { key: 'affiliate',         label: 'Affiliates',         icon: 'bi-link-45deg' },
  { key: 'affiliate_limited', label: 'Limited Affiliates', icon: 'bi-link-45deg' },
  { key: 'paid_creator',      label: 'Paid Collabs',       icon: 'bi-people' },
  { key: 'ads',               label: 'GMV Max',            icon: 'bi-graph-up-arrow' },
  { key: 'shop',              label: 'Shop Monitoring',    icon: 'bi-shop' },
];
const SCOPE_LABEL: Record<string, string> = Object.fromEntries(SCOPE_OPTIONS.map(o => [o.key, o.label]));
const SCOPE_ICON:  Record<string, string> = Object.fromEntries(SCOPE_OPTIONS.map(o => [o.key, o.icon]));

const STATUS_LABEL: Record<ClientStatus, string> = {
  active:      'Active',
  new_account: 'New Account',
  inactive:    'Inactive',
};

const empty = {
  name: '',
  client_id: '',
  scope: [] as ScopeKey[],
  client_status: 'active' as ClientStatus,
  shop_code: '',
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
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [b, c] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('clients').select('id,name').order('name'),
    ]);
    if (b.error || c.error) setErr((b.error ?? c.error)!.message);
    else {
      const rows = (b.data as any[]).map(r => ({
        ...r,
        scope: Array.isArray(r.scope) ? r.scope : [],
        client_status: (r.client_status ?? 'active') as ClientStatus,
        shop_code: r.shop_code ?? null,
      })) as Brand[];
      setBrands(rows);
      setClients((c.data as ClientLite[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return brands;
    const q = search.trim().toLowerCase();
    return brands.filter(b =>
      `${b.name} ${b.client ?? ''} ${b.shop_code ?? ''} ${b.scope.join(' ')}`.toLowerCase().includes(q)
    );
  }, [brands, search]);

  const counts = useMemo(() => {
    let active = 0, newAcct = 0, inactive = 0;
    brands.forEach(b => {
      if (b.client_status === 'active') active++;
      else if (b.client_status === 'new_account') newAcct++;
      else if (b.client_status === 'inactive') inactive++;
    });
    return { active, newAcct, inactive };
  }, [brands]);

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
      scope: (b.scope ?? []) as ScopeKey[],
      client_status: b.client_status,
      shop_code: b.shop_code ?? '',
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

  const toggleScope = (k: ScopeKey) => {
    setForm(f => ({
      ...f,
      scope: f.scope.includes(k) ? f.scope.filter(x => x !== k) : [...f.scope, k],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const clientName = clients.find(c => c.id === form.client_id)?.name ?? '';
    const payload = {
      name: form.name.trim(),
      client_id: form.client_id || null,
      client: clientName,
      scope: form.scope,
      client_status: form.client_status,
      shop_code: form.shop_code.trim() || null,
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
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Brands</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{brands.length}</span>
            <span className="ac-stat-label">brand{brands.length === 1 ? '' : 's'}</span>
          </span>
          {counts.active > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num" style={{ color: '#10b981' }}>{counts.active}</span>
              <span className="ac-stat-label">active</span>
            </span>
          )}
          {counts.newAcct > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num" style={{ color: '#2563eb' }}>{counts.newAcct}</span>
              <span className="ac-stat-label">new account{counts.newAcct === 1 ? '' : 's'}</span>
            </span>
          )}
          {counts.inactive > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num" style={{ color: '#6e6e80' }}>{counts.inactive}</span>
              <span className="ac-stat-label">inactive</span>
            </span>
          )}
        </div>
        {isBob && (
          <Button onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" /> Add Brand
          </Button>
        )}
      </div>

      {brands.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input
            placeholder="Search by brand, client, scope, or shop code…"
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
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : brands.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-shop" /></div>
              <h5>No brands yet</h5>
              <p>Add your first brand. You'll capture its client, scope, status, and shop code — and from there create weekly reports, set up GMV Max, and share with clients.</p>
              {isBob && (
                <Button className="mt-3" onClick={openAdd}>
                  <i className="bi bi-plus-lg me-1" /> Add Brand
                </Button>
              )}
            </div>
          </Card.Body>
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No brands match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filtered.map(b => (
            <div className="ac-list-row" key={b.id}
              role="button"
              onClick={() => nav(`/brands/${b.id}`)}
              style={{ cursor: 'pointer' }}>
              <Avatar name={b.name} size="lg" />
              <div className="ac-row-main">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <div className="ac-row-name">{b.name}</div>
                  <StatusBadge status={b.client_status} />
                </div>
                <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                  {b.client ? (
                    <span><i className="bi bi-building me-1" />{b.client}</span>
                  ) : (
                    <span className="fst-italic">No client linked</span>
                  )}
                  {b.shop_code && (
                    <span className="ac-shop-code" title="Shop code"
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(b.shop_code!); }}>
                      <i className="bi bi-upc-scan" /> {b.shop_code}
                    </span>
                  )}
                </div>
                {b.scope.length > 0 && (
                  <div className="mt-2 ac-chip-group">
                    {b.scope.map(k => (
                      <span key={k} className="ac-chip">
                        <i className={`bi ${SCOPE_ICON[k] ?? 'bi-tag'}`} /> {SCOPE_LABEL[k] ?? k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canEditAny && (
                <div className="ac-row-actions" onClick={e => e.stopPropagation()}>
                  <button className="ac-icon-btn" onClick={() => openEdit(b)} title="Edit brand">
                    <i className="bi bi-pencil" />
                  </button>
                  {isBob && (
                    <button className="ac-icon-btn danger" onClick={() => remove(b)} title="Delete brand">
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered size="lg">
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editId ? 'Edit Brand' : 'Add Brand'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <div className="row g-3">
              <Form.Group className="col-md-7">
                <Form.Label>Store name</Form.Label>
                <Form.Control required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. MyRosy Beauty" />
              </Form.Group>
              <Form.Group className="col-md-5">
                <Form.Label>Shop code</Form.Label>
                <Form.Control
                  value={form.shop_code}
                  onChange={e => setForm({ ...form, shop_code: e.target.value.toUpperCase() })}
                  placeholder="e.g. USLCJYEAPD"
                  style={{ fontFamily: 'monospace', letterSpacing: '.5px' }}
                />
              </Form.Group>
              <Form.Group className="col-md-7">
                <Form.Label>Client</Form.Label>
                <Form.Select required value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— Choose client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>
                {clients.length === 0 && (
                  <Form.Text className="text-muted">No clients yet — add one from the Clients menu first.</Form.Text>
                )}
              </Form.Group>
              <Form.Group className="col-md-5">
                <Form.Label>Client status</Form.Label>
                <Form.Select value={form.client_status} onChange={e => setForm({ ...form, client_status: e.target.value as ClientStatus })}>
                  <option value="active">Active</option>
                  <option value="new_account">New Account</option>
                  <option value="inactive">Inactive</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-12">
                <Form.Label>Scope <small className="text-muted fw-normal">— pick all that apply</small></Form.Label>
                <div className="ac-chip-group">
                  {SCOPE_OPTIONS.map(o => {
                    const on = form.scope.includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => toggleScope(o.key)}
                        className={`ac-chip ${on ? '' : 'neutral'}`}
                        style={{
                          cursor: 'pointer',
                          opacity: on ? 1 : .85,
                          background: on ? undefined : '#fff',
                        }}
                      >
                        <i className={`bi ${on ? 'bi-check2' : o.icon}`} /> {o.label}
                      </button>
                    );
                  })}
                </div>
              </Form.Group>
            </div>
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

function StatusBadge({ status }: { status: ClientStatus }) {
  const map: Record<ClientStatus, { bg: string; color: string; label: string; icon: string }> = {
    active:      { bg: 'rgba(16,185,129,.12)',  color: '#047857', label: 'Active',      icon: 'bi-check-circle-fill' },
    new_account: { bg: 'rgba(37,99,235,.12)',   color: '#1d4ed8', label: 'New Account', icon: 'bi-stars' },
    inactive:    { bg: 'rgba(110,110,128,.12)', color: '#475569', label: 'Inactive',    icon: 'bi-pause-circle-fill' },
  };
  const m = map[status];
  return (
    <span className="ac-chip" style={{ background: m.bg, color: m.color, borderColor: 'transparent' }}>
      <i className={`bi ${m.icon}`} /> {m.label}
    </span>
  );
}
