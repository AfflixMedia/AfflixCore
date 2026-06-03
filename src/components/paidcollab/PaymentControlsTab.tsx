import { useEffect, useMemo, useState } from 'react';
import { Card, Form, Spinner, Alert, Badge, InputGroup, Button } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, PaymentPopupOverride,
  programDisplayName, isCreatorPaymentPendingAuto, isCreatorPaymentPending,
  fmtMoney,
} from '../../lib/paidCollabSchema';

interface Props {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}

const OVERRIDE_META: Record<PaymentPopupOverride, { label: string; sub: string; color: string; icon: string }> = {
  auto: {
    label: 'Automatic',
    sub: 'Show only for creators whose videos have all gone live',
    color: '#6c757d',
    icon: 'bi-magic',
  },
  force_show: {
    label: 'Always show',
    sub: 'Force the Payment-pending badge on for every creator in the program',
    color: '#e8862e',
    icon: 'bi-eye-fill',
  },
  force_hide: {
    label: 'Always hide',
    sub: 'Master OFF — never show the Payment-pending badge for this program',
    color: '#0d6efd',
    icon: 'bi-eye-slash-fill',
  },
};

export default function PaymentControlsTab({ brandId, brandName, canEdit }: Props) {
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all');

  const reload = async () => {
    setLoading(true); setErr(null);
    try {
      const { data: p, error: pErr } = await supabase
        .from('paid_creator_programs').select('*').eq('brand_id', brandId)
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;
      const progs = (p ?? []) as PaidProgram[];
      setPrograms(progs);
      const progIds = progs.map(x => x.id);
      if (progIds.length === 0) {
        setCreators([]); setVideos([]); setLoading(false); return;
      }
      const { data: cRows, error: cErr } = await supabase
        .from('paid_creators').select('*').in('program_id', progIds);
      if (cErr) throw cErr;
      const cs = (cRows as PaidCreator[]) ?? [];
      setCreators(cs);
      if (cs.length === 0) { setVideos([]); setLoading(false); return; }
      const { data: vRows, error: vErr } = await supabase
        .from('paid_creator_videos').select('id,creator_id,status').in('creator_id', cs.map(c => c.id));
      if (vErr) throw vErr;
      setVideos((vRows ?? []) as PaidVideo[]);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [brandId]);

  const programById = useMemo(() => {
    const m = new Map<string, PaidProgram>();
    for (const p of programs) m.set(p.id, p);
    return m;
  }, [programs]);

  const liveByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    return m;
  }, [videos]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return creators.filter(c => {
      const live = liveByCreator.get(c.id) ?? 0;
      const auto = isCreatorPaymentPendingAuto(c, live);
      if (programFilter && c.program_id !== programFilter) return false;
      if (statusFilter === 'pending' && !auto) return false;
      if (statusFilter === 'paid' && !c.paid_out) return false;
      if (q) {
        const p = programById.get(c.program_id);
        const hay = `${c.name} ${c.handle ?? ''} ${programDisplayName(p ?? null)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [creators, liveByCreator, programFilter, statusFilter, programById, search]);

  const totals = useMemo(() => {
    let pending = 0, paid = 0, shown = 0;
    for (const c of creators) {
      const live = liveByCreator.get(c.id) ?? 0;
      if (c.paid_out) paid += 1;
      else if (isCreatorPaymentPendingAuto(c, live)) pending += 1;
      if (isCreatorPaymentPending(c, live, programById.get(c.program_id))) shown += 1;
    }
    return { pending, paid, shown };
  }, [creators, liveByCreator, programById]);

  const updateProgram = async (programId: string, val: PaymentPopupOverride) => {
    const prev = programs;
    setPrograms(programs.map(p => p.id === programId ? { ...p, payment_popup_default: val } : p));
    const { error } = await supabase.from('paid_creator_programs')
      .update({ payment_popup_default: val }).eq('id', programId);
    if (error) { alert(error.message); setPrograms(prev); }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <>
      <Card className="shadow-sm mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
            <div>
              <h6 className="mb-1 fw-bold">
                <i className="bi bi-cash-stack me-2 text-warning" />
                Payment-pending popup controls — {brandName}
              </h6>
              <div className="text-muted small">
                The <strong>program toggle</strong> is the single master control for the
                Payment-pending badge. <code>Always hide</code> turns it off for everyone in
                the program; <code>Automatic</code> shows it only for creators whose videos
                have all gone live; <code>Always show</code> forces it on for every creator.
              </div>
            </div>
            <div className="d-flex gap-2">
              <KpiTile label="Pending (auto)" value={totals.pending} color="#e8862e" icon="bi-cash-stack" />
              <KpiTile label="Badge showing" value={totals.shown} color="#d97706" icon="bi-eye" />
              <KpiTile label="Paid" value={totals.paid} color="#198754" icon="bi-check2-circle" />
            </div>
          </div>

          {programs.length === 0 ? (
            <div className="text-muted text-center py-4 small">No programs for this brand yet.</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {programs.map(p => (
                <div key={p.id} className="p-3 rounded d-flex flex-wrap align-items-center gap-3"
                  style={{ background: '#fafafa', border: '1px solid #e9ecef' }}>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-bold text-truncate">
                      <i className="bi bi-collection me-2 text-primary" />
                      {programDisplayName(p)}
                      {p.ended_at && <Badge bg="secondary" className="ms-2">Ended</Badge>}
                    </div>
                    <div className="text-muted small">
                      Currency: {p.currency} · Budget: {fmtMoney(Number(p.total_budget || 0), p.currency)}
                    </div>
                  </div>
                  <OverrideSegmented
                    value={p.payment_popup_default ?? 'auto'}
                    canEdit={canEdit}
                    onChange={(v) => updateProgram(p.id, v)}
                  />
                </div>
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Pending overview — read-only list of creators with effective visibility. */}
      <Card className="shadow-sm">
        <Card.Body>
          <h6 className="mb-3 fw-bold">
            <i className="bi bi-people me-2 text-primary" />
            Pending payment overview
          </h6>

          <div className="row g-2 mb-3">
            <div className="col-md">
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control placeholder="Search creator, handle, program…"
                  value={search} onChange={e => setSearch(e.target.value)} />
                {search && (
                  <Button variant="outline-secondary" onClick={() => setSearch('')}>
                    <i className="bi bi-x-lg" />
                  </Button>
                )}
              </InputGroup>
            </div>
            <div className="col-md-auto">
              <Form.Select size="sm" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
                <option value="">All programs</option>
                {programs.map(p => (
                  <option key={p.id} value={p.id}>{programDisplayName(p)}</option>
                ))}
              </Form.Select>
            </div>
            <div className="col-md-auto">
              <Form.Select size="sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                <option value="all">All statuses</option>
                <option value="pending">Payment pending</option>
                <option value="paid">Paid</option>
              </Form.Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="text-muted text-center py-4 small">
              {creators.length === 0 ? 'No creators in this brand yet.' : 'No creators match your filters.'}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="small text-uppercase text-muted fw-bold">
                  <tr>
                    <th>Creator</th>
                    <th>Program</th>
                    <th>Deliverables</th>
                    <th>Fee</th>
                    <th>Status</th>
                    <th>Badge</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(c => {
                    const live = liveByCreator.get(c.id) ?? 0;
                    const auto = isCreatorPaymentPendingAuto(c, live);
                    const p = programById.get(c.program_id);
                    const willShow = isCreatorPaymentPending(c, live, p);
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="fw-semibold">{c.name}</div>
                          {c.handle && <div className="text-muted small"><i className="bi bi-at" />{c.handle.replace(/^@/, '')}</div>}
                        </td>
                        <td className="small">{p ? programDisplayName(p) : '—'}</td>
                        <td className="small">{live}/{c.agreed_videos}</td>
                        <td className="small">{fmtMoney(Number(c.fee || 0), p?.currency || 'USD')}</td>
                        <td>
                          {c.paid_out ? (
                            <Badge bg="success"><i className="bi bi-check-circle me-1" />Paid</Badge>
                          ) : auto ? (
                            <Badge bg="warning" text="dark"><i className="bi bi-cash-stack me-1" />Pending</Badge>
                          ) : (
                            <Badge bg="light" text="dark" className="border">Not yet</Badge>
                          )}
                        </td>
                        <td>
                          {willShow ? (
                            <Badge bg="" style={{ backgroundColor: '#e8862e', color: '#fff' }}>
                              <i className="bi bi-eye-fill me-1" />Shown
                            </Badge>
                          ) : (
                            <Badge bg="" style={{ backgroundColor: '#475569', color: '#fff' }}>
                              <i className="bi bi-eye-slash-fill me-1" />Hidden
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card.Body>
      </Card>
    </>
  );
}

function OverrideSegmented({
  value, canEdit, onChange,
}: {
  value: PaymentPopupOverride;
  canEdit: boolean;
  onChange: (v: PaymentPopupOverride) => void;
}) {
  const items: PaymentPopupOverride[] = ['force_hide', 'auto', 'force_show'];
  return (
    <div className="btn-group" role="group">
      {items.map(k => {
        const meta = OVERRIDE_META[k];
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            disabled={!canEdit}
            onClick={() => onChange(k)}
            className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{
              backgroundColor: active ? meta.color : undefined,
              borderColor: active ? meta.color : undefined,
              fontSize: '.85rem',
            }}
            title={meta.sub}
          >
            <i className={`bi ${meta.icon} me-1`} />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function KpiTile({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="p-2 rounded text-center" style={{
      background: 'rgba(20,22,32,.03)', border: '1px solid #e9ecef', minWidth: 110,
    }}>
      <div className="text-muted" style={{ fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>
        <i className={`bi ${icon} me-1`} style={{ color }} />{label}
      </div>
      <div className="fw-bold" style={{ fontSize: '1.2rem', color }}>{value}</div>
    </div>
  );
}
