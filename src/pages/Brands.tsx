import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Modal, Form, Spinner, Alert, Row, Col, InputGroup } from 'react-bootstrap';
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
  notes: string | null;
  created_at: string;
}
interface ClientLite { id: string; name: string; }

type ClientStatus = 'onboarding' | 'in_progress' | 'paused' | 'closed';

const STATUS_ORDER: ClientStatus[] = ['onboarding', 'in_progress', 'paused', 'closed'];

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
  onboarding:  'Onboarding',
  in_progress: 'In Progress',
  paused:      'Temporarily Paused',
  closed:      'Closed',
};

const STATUS_META: Record<ClientStatus, { bg: string; color: string; icon: string }> = {
  onboarding:  { bg: 'rgba(37,99,235,.12)',   color: '#1d4ed8', icon: 'bi-rocket-takeoff-fill' },
  in_progress: { bg: 'rgba(16,185,129,.12)',  color: '#047857', icon: 'bi-check-circle-fill' },
  paused:      { bg: 'rgba(245,158,11,.16)',  color: '#b45309', icon: 'bi-pause-circle-fill' },
  closed:      { bg: 'rgba(110,110,128,.14)', color: '#475569', icon: 'bi-x-circle-fill' },
};

const empty = {
  name: '',
  client_id: '',
  scope: [] as ScopeKey[],
  client_status: 'in_progress' as ClientStatus,
  shop_code: '',
  notes: '',
  monthly_fee: 0,
  paid_current_month: false,
};

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthLabel(date: Date) {
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

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
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');
  const [clientFilter, setClientFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeKey | ''>('');

  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  // Brand monthly fees — Bob only. Lives in the Bob-only `brand_billing`
  // table; never on the APC-readable `brands` row.
  const [feeByBrand, setFeeByBrand] = useState<Record<string, number>>({});

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
        client_status: (r.client_status ?? 'in_progress') as ClientStatus,
        shop_code: r.shop_code ?? null,
        notes: r.notes ?? null,
      })) as Brand[];
      setBrands(rows);
      setClients((c.data as ClientLite[]) ?? []);
    }
    // Bob-only: fetch monthly fees from the locked-down billing table.
    if (isBob) {
      const { data: billing } = await supabase.from('brand_billing').select('brand_id,monthly_fee');
      const map: Record<string, number> = {};
      (billing ?? []).forEach((r: any) => { map[r.brand_id] = Number(r.monthly_fee ?? 0); });
      setFeeByBrand(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands.filter(b => {
      if (statusFilter !== 'all' && b.client_status !== statusFilter) return false;
      if (clientFilter && b.client_id !== clientFilter) return false;
      if (scopeFilter && !b.scope.includes(scopeFilter)) return false;
      if (q) {
        const hay = `${b.name} ${b.client ?? ''} ${b.shop_code ?? ''} ${b.scope.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [brands, search, statusFilter, clientFilter, scopeFilter]);

  const counts = useMemo(() => {
    const c: Record<ClientStatus, number> = { onboarding: 0, in_progress: 0, paused: 0, closed: 0 };
    brands.forEach(b => { if (c[b.client_status] !== undefined) c[b.client_status]++; });
    return c;
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
      notes: b.notes ?? '',
      monthly_fee: isBob ? Number(feeByBrand[b.id] ?? 0) : 0,
      paid_current_month: false,
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
    // NOTE: the brand row never carries the monthly fee — it lives in the
    // Bob-only `brand_billing` table so APCs can never read it.
    const payload = {
      name: form.name.trim(),
      client_id: form.client_id || null,
      client: clientName,
      scope: form.scope,
      client_status: form.client_status,
      shop_code: form.shop_code.trim() || null,
      notes: form.notes.trim() || null,
    };
    const fee = Number.isFinite(form.monthly_fee) ? form.monthly_fee : 0;
    let brandId = editId;
    if (editId) {
      const { error } = await supabase.from('brands').update(payload).eq('id', editId);
      if (error) { setErr(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('brands').insert(payload).select('id').single();
      if (error) { setErr(error.message); setSaving(false); return; }
      brandId = (data as any)?.id ?? null;
    }
    // Bob only: persist the monthly fee into the locked-down billing table.
    if (isBob && brandId) {
      const { error: feeErr } = await supabase.from('brand_billing')
        .upsert({ brand_id: brandId, monthly_fee: fee }, { onConflict: 'brand_id' });
      if (feeErr) {
        setErr(`Brand saved, but the monthly fee could not be stored: ${feeErr.message}`);
        setSaving(false);
        load();
        return;
      }
    }
    // If creating a brand and the client has already paid for the current
    // month, drop a brand_payments row so the Budget Manager picks it up.
    if (isBob && !editId && form.paid_current_month && brandId && fee > 0) {
      const { error: payErr } = await supabase.from('brand_payments').insert({
        brand_id: brandId,
        month: currentMonthIso(),
        amount: fee,
        notes: 'Marked paid at brand creation',
      });
      if (payErr) {
        // Brand was created — surface the error but don't roll back.
        setErr(`Brand saved, but payment record failed: ${payErr.message}`);
        setSaving(false);
        load();
        return;
      }
    }
    setSaving(false);
    setShow(false);
    load();
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
          {STATUS_ORDER.map(s => counts[s] > 0 && (
            <span className="ac-stat-pill" key={s}>
              <span className="ac-stat-num" style={{ color: STATUS_META[s].color }}>{counts[s]}</span>
              <span className="ac-stat-label">{STATUS_LABEL[s].toLowerCase()}</span>
            </span>
          ))}
        </div>
        {isBob && (
          <Button onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" /> Add Brand
          </Button>
        )}
      </div>

      {brands.length > 0 && (
        <Card className="mb-3">
          <Card.Body className="py-2">
            <Row className="g-2 align-items-center">
              <Col md>
                <InputGroup size="sm">
                  <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                  <Form.Control
                    placeholder="Search by brand, client, scope, or shop code…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && (
                    <Button variant="outline-secondary" onClick={() => setSearch('')}>
                      <i className="bi bi-x-lg" />
                    </Button>
                  )}
                </InputGroup>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}>
                  <option value="all">All statuses</option>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Form.Select>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                  <option value="">All clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={scopeFilter}
                  onChange={e => setScopeFilter(e.target.value as ScopeKey | '')}>
                  <option value="">All scopes</option>
                  {SCOPE_OPTIONS.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </Form.Select>
              </Col>
              {(statusFilter !== 'all' || clientFilter || scopeFilter || search) && (
                <Col md="auto">
                  <Button size="sm" variant="link" className="text-muted"
                    onClick={() => { setSearch(''); setStatusFilter('all'); setClientFilter(''); setScopeFilter(''); }}>
                    Clear filters
                  </Button>
                </Col>
              )}
            </Row>
          </Card.Body>
        </Card>
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
          No brands match your filters.
        </Card>
      ) : (
        <Row className="g-3">
          {filtered.map(b => (
            <Col xs={12} md={6} lg={4} xl={3} key={b.id}>
              <Card
                className="h-100 shadow-sm"
                role="button"
                onClick={() => nav(`/brands/${b.id}`)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                style={{ cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
              >
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex align-items-start gap-2 mb-2">
                    <Avatar name={b.name} size="lg" />
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate" style={{ fontSize: '1.05rem' }}>{b.name}</div>
                      <div className="text-muted small text-truncate">
                        {b.client ? <><i className="bi bi-building me-1" />{b.client}</> : <span className="fst-italic">No client linked</span>}
                      </div>
                    </div>
                    {canEditAny && (
                      <div className="d-flex flex-column gap-1" onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-link p-0 text-muted" onClick={() => openEdit(b)} title="Edit brand">
                          <i className="bi bi-pencil" />
                        </button>
                        {isBob && (
                          <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => remove(b)} title="Delete brand">
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
                    <StatusBadge status={b.client_status} />
                    {b.shop_code && (
                      <span className="ac-shop-code" title="Shop code"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(b.shop_code!); }}>
                        <i className="bi bi-upc-scan" /> {b.shop_code}
                      </span>
                    )}
                  </div>

                  {b.notes && (
                    <div className="text-muted small mb-2" title={b.notes}
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <i className="bi bi-sticky me-1" />{b.notes}
                    </div>
                  )}

                  {b.scope.length > 0 && (
                    <div className="mt-auto pt-2 ac-chip-group">
                      {b.scope.map(k => (
                        <span key={k} className="ac-chip">
                          <i className={`bi ${SCOPE_ICON[k] ?? 'bi-tag'}`} /> {SCOPE_LABEL[k] ?? k}
                        </span>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
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
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Form.Select>
              </Form.Group>
              {/* Monthly fee + paid-status — Bob only. APCs never see or
                  submit budget data. */}
              {isBob && (
              <Form.Group className="col-md-5">
                <Form.Label>
                  Monthly fee <small className="text-muted fw-normal">(USD)</small>
                </Form.Label>
                <InputGroup>
                  <InputGroup.Text>$</InputGroup.Text>
                  <Form.Control
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.monthly_fee || ''}
                    placeholder="e.g. 750"
                    onChange={e => setForm({ ...form, monthly_fee: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </InputGroup>
                <Form.Text className="text-muted">
                  Amount the client pays each month to manage this brand.
                </Form.Text>
              </Form.Group>
              )}
              {isBob && !editId && (
                <Form.Group className="col-md-7 d-flex align-items-end">
                  <div
                    className={`w-100 p-3 rounded border ${form.paid_current_month ? 'border-success bg-success-subtle' : 'border-secondary-subtle bg-light'}`}
                    style={{ cursor: form.monthly_fee > 0 ? 'pointer' : 'not-allowed', opacity: form.monthly_fee > 0 ? 1 : 0.6 }}
                    onClick={() => {
                      if (form.monthly_fee > 0) setForm({ ...form, paid_current_month: !form.paid_current_month });
                    }}
                  >
                    <Form.Check
                      type="switch"
                      id="paid-current-month"
                      checked={form.paid_current_month}
                      disabled={form.monthly_fee <= 0}
                      onChange={e => setForm({ ...form, paid_current_month: e.target.checked })}
                      label={<>
                        <span className="fw-semibold">Client has paid for {monthLabel(new Date())}</span>
                        <div className="small text-muted mt-1">
                          {form.paid_current_month
                            ? `A paid record of $${form.monthly_fee.toFixed(2)} will be added for this month.`
                            : 'Leave off if payment is still pending — Budget Manager will show it as outstanding.'}
                        </div>
                      </>}
                    />
                  </div>
                </Form.Group>
              )}
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
              <Form.Group className="col-12">
                <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={form.notes}
                  placeholder="Any context about this brand — onboarding details, preferences, reminders…"
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
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
  const m = STATUS_META[status] ?? STATUS_META.in_progress;
  return (
    <span className="ac-chip" style={{ background: m.bg, color: m.color, borderColor: 'transparent' }}>
      <i className={`bi ${m.icon}`} /> {STATUS_LABEL[status] ?? status}
    </span>
  );
}
