import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';

export interface EmployeeRoleConfig {
  /** Role value stored in profiles.role */
  role: string;
  /** Singular label, e.g. "APC" */
  label: string;
  /** Plural label, e.g. "APCs" */
  labelPlural: string;
  /** Subtitle / empty-state copy */
  description: string;
  /** Bootstrap icon class, e.g. "bi-people" */
  icon: string;
  /** Show brand assignment (currently APC only) */
  hasBrandAssignment?: boolean;
  /** Show APC-style permission toggles (currently APC only) */
  hasPermissions?: boolean;
}

interface Employee {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  can_edit_brands: boolean;
  can_manage_gmv_max: boolean;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function Employees({ config }: { config: EmployeeRoleConfig }) {
  const [items, setItems] = useState<Employee[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[], can_edit_brands: false, can_manage_gmv_max: false });
  const [saving, setSaving] = useState(false);

  const [pwTarget, setPwTarget] = useState<Employee | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delTarget, setDelTarget] = useState<Employee | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const wantsBrands = !!config.hasBrandAssignment;
  const wantsPerms  = !!config.hasPermissions;

  const load = async () => {
    setLoading(true); setErr(null);
    const empRes = await supabase.from('profiles')
      .select('id,email,full_name,role,created_at,can_edit_brands,can_manage_gmv_max')
      .eq('role', config.role)
      .order('created_at', { ascending: false });
    if (empRes.error) { setErr(empRes.error.message); setLoading(false); return; }

    let brandRows: BrandLite[] = [];
    let assigns: { apc_id: string; brand_id: string }[] = [];
    if (wantsBrands) {
      const [brandRes, assignRes] = await Promise.all([
        supabase.from('brands').select('id,name').order('name'),
        supabase.from('apc_brands').select('apc_id,brand_id'),
      ]);
      if (brandRes.error) { setErr(brandRes.error.message); setLoading(false); return; }
      if (assignRes.error) { setErr(assignRes.error.message); setLoading(false); return; }
      brandRows = (brandRes.data ?? []) as BrandLite[];
      assigns = (assignRes.data ?? []) as { apc_id: string; brand_id: string }[];
    }
    const brandMap = new Map<string, string>(brandRows.map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    assigns.forEach(a => {
      const arr = assignMap.get(a.apc_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.apc_id, arr);
    });
    setBrands(brandRows);
    setItems((empRes.data ?? []).map((a: any) => ({
      ...a,
      can_edit_brands: !!a.can_edit_brands,
      can_manage_gmv_max: !!a.can_manage_gmv_max,
      brand_ids: assignMap.get(a.id) ?? [],
      brand_names: (assignMap.get(a.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [config.role]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(a =>
      `${a.full_name ?? ''} ${a.email} ${(a.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalAssignments = items.reduce((s, a) => s + (a.brand_ids?.length ?? 0), 0);

  const openAdd = () => {
    setEditing(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [], can_edit_brands: false, can_manage_gmv_max: false });
    setErr(null);
    setShow(true);
  };

  const openEdit = (a: Employee) => {
    setEditing(a);
    setForm({ email: a.email, password: '', full_name: a.full_name ?? '', brand_ids: a.brand_ids ?? [], can_edit_brands: a.can_edit_brands, can_manage_gmv_max: a.can_manage_gmv_max });
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
      if (editing) {
        const profileUpdate: Record<string, any> = { full_name: form.full_name };
        if (wantsPerms) {
          profileUpdate.can_edit_brands    = form.can_edit_brands;
          profileUpdate.can_manage_gmv_max = form.can_manage_gmv_max;
        }
        const { error: pErr } = await supabase.from('profiles').update(profileUpdate).eq('id', editing.id);
        if (pErr) throw pErr;
        if (wantsBrands) {
          const { error: dErr } = await supabase.from('apc_brands').delete().eq('apc_id', editing.id);
          if (dErr) throw dErr;
          if (form.brand_ids.length > 0) {
            const rows = form.brand_ids.map(bid => ({ apc_id: editing.id, brand_id: bid }));
            const { error: iErr } = await supabase.from('apc_brands').insert(rows);
            if (iErr) throw iErr;
          }
        }
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-apc', {
          body: {
            role: config.role,
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: wantsBrands ? form.brand_ids : [],
            can_edit_brands:    wantsPerms ? form.can_edit_brands    : false,
            can_manage_gmv_max: wantsPerms ? form.can_manage_gmv_max : false,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        // The deployed create-apc may not yet honour the `role` field — patch
        // profiles afterwards so non-APC roles land correctly. Idempotent for
        // the APC case.
        const newId = (data as any).id;
        if (newId && config.role !== 'apc') {
          const { error: rErr } = await supabase.from('profiles')
            .update({ role: config.role }).eq('id', newId);
          if (rErr) throw rErr;
        }
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
          <h2>{config.labelPlural}</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{items.length}</span>
            <span className="ac-stat-label">{config.label.toLowerCase()}{items.length === 1 ? '' : 's'}</span>
          </span>
          {wantsBrands && totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add {config.label}
        </Button>
      </div>

      {items.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input
            placeholder={wantsBrands ? 'Search by name, email, or brand…' : 'Search by name or email…'}
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
      ) : err && items.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : items.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className={`bi ${config.icon}`} /></div>
              <h5>No {config.labelPlural.toLowerCase()} yet</h5>
              <p>{config.description}</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add {config.label}
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No {config.labelPlural.toLowerCase()} match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filtered.map(a => {
            const display = a.full_name || a.email;
            return (
              <div className="ac-list-row" key={a.id}>
                <Avatar name={display} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{a.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{a.email}</span>
                    {wantsPerms && a.can_edit_brands && (
                      <span className="ac-chip warning" title="Can edit brand details">
                        <i className="bi bi-pencil-square" /> Brand editor
                      </span>
                    )}
                    {wantsPerms && a.can_manage_gmv_max && (
                      <span className="ac-chip" title="Can manage GMV Max budgets">
                        <i className="bi bi-graph-up" /> GMV Max
                      </span>
                    )}
                  </div>
                  {wantsBrands && (
                    <div className="mt-2 ac-chip-group">
                      {(a.brand_names ?? []).length === 0 ? (
                        <span className="text-muted small fst-italic">No brands assigned</span>
                      ) : a.brand_names!.map(n => (
                        <span key={n} className="ac-chip neutral">
                          <i className="bi bi-shop" /> {n}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwTarget(a); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(a)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn danger"
                    onClick={() => { setDelTarget(a); setDelErr(null); }} title={`Delete ${config.label}`}>
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
            <Modal.Title>{editing ? `Edit ${config.label}` : `Add ${config.label}`}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editing} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editing && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editing && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with them so they can sign in.</Form.Text>
              </Form.Group>
            )}

            {wantsPerms && (
              <Form.Group className="mb-3">
                <Form.Label className="fw-semibold mb-1">Permissions</Form.Label>
                <div className="border rounded p-2">
                  <Form.Check
                    type="switch"
                    id="can-edit-brands"
                    label={<><strong>Edit brand details</strong> <span className="text-muted small">— name, client, GMV, tier on assigned brands</span></>}
                    checked={form.can_edit_brands}
                    onChange={e => setForm({ ...form, can_edit_brands: e.target.checked })}
                  />
                  <Form.Check
                    type="switch"
                    className="mt-2"
                    id="can-manage-gmv-max"
                    label={<><strong>Manage GMV Max</strong> <span className="text-muted small">— monthly budgets and weekly entries on assigned brands</span></>}
                    checked={form.can_manage_gmv_max}
                    onChange={e => setForm({ ...form, can_manage_gmv_max: e.target.checked })}
                  />
                </div>
                <Form.Text className="text-muted">
                  Bob can always do everything; these toggles only widen what an APC can do.
                </Form.Text>
              </Form.Group>
            )}

            {wantsBrands && (
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
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : (editing ? 'Save' : `Create ${config.label}`)}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwTarget} onHide={() => setPwTarget(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwTarget) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-apc-password', {
              body: { user_id: pwTarget.id, password: newPw },
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
            <Modal.Title>Reset password — {pwTarget?.full_name || pwTarget?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with them.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. afflix-2026" autoFocus />
              <Form.Text className="text-muted">They can sign in with this immediately. Copy and send manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwTarget(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delTarget} onHide={() => !delBusy && setDelTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete {config.label}?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delTarget?.full_name || delTarget?.email}</strong> and revoke their access.{wantsBrands && ' Their brand assignments will be cleared.'}</p>
          <p className="text-muted small mb-0">This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelTarget(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delTarget) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-apc', {
                body: { user_id: delTarget.id },
              });
              if (error) throw error;
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelTarget(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : `Delete ${config.label}`}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

// =============================================================================
// Per-role pre-configured pages so each route can render `<EmployeesXxx />`.
// =============================================================================

export function EmployeesAPCs() {
  return <Employees config={{
    role: 'apc',
    label: 'APC',
    labelPlural: 'APCs',
    description: "Account managers. Assign them to brands so they can manage reporting, resources, and the items you've granted permissions for.",
    icon: 'bi-person-badge',
    hasBrandAssignment: true,
    hasPermissions: true,
  }} />;
}

export function EmployeesAffiliateTLs() {
  return <Employees config={{
    role: 'affiliate_tl',
    label: 'Affiliate TL',
    labelPlural: 'Affiliate TLs',
    description: 'Team leads who run the affiliate side of brand operations.',
    icon: 'bi-link-45deg',
  }} />;
}

export function EmployeesPaidCollabTLs() {
  return <Employees config={{
    role: 'paid_collab_tl',
    label: 'Paid Collab TL',
    labelPlural: 'Paid Collab TLs',
    description: 'Team leads coordinating paid-creator collaborations.',
    icon: 'bi-cash-coin',
  }} />;
}

export function EmployeesOperationLeads() {
  return <Employees config={{
    role: 'operation_lead',
    label: 'Operation Lead',
    labelPlural: 'Operation Leads',
    description: 'Operations leads overseeing day-to-day execution across teams.',
    icon: 'bi-diagram-3',
  }} />;
}

export function EmployeesIPCs() {
  return <Employees config={{
    role: 'ipc',
    label: 'IPC',
    labelPlural: 'IPCs',
    description: 'Internal product / project coordinators.',
    icon: 'bi-people-fill',
  }} />;
}

export function EmployeesDevelopers() {
  return <Employees config={{
    role: 'developer',
    label: 'Developer',
    labelPlural: 'Developers',
    description: 'Engineers building and maintaining the platform.',
    icon: 'bi-code-slash',
  }} />;
}
