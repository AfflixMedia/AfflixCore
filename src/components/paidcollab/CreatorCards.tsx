import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Card, Button, Modal, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidCreator, PaidVideo, CreatorStatus, VideoStatus, CREATOR_STATUS_META,
  BrandProduct,
  fmtMoney, daysBetween, todayISO,
} from '../../lib/paidCollabSchema';
import Avatar from '../Avatar';
import NumberInput from '../NumberInput';
import PerformanceModal from './PerformanceModal';
import ProgramThreadPanel, { ProgramThreadComment } from './ProgramThreadPanel';

interface Props {
  programId: string;
  /** Program + brand context — used to resolve Payment-pending popup overrides. */
  program?: { payment_popup_default?: 'auto' | 'force_hide' | 'force_show' } | null;
  brand?: { payment_popup_default?: 'auto' | 'force_hide' | 'force_show' } | null;
  currency: string;
  launchDate: string | null;
  creators: PaidCreator[];
  videos: PaidVideo[];
  programProducts: BrandProduct[];
  canEdit: boolean;
  onCreatorsChange: (next: PaidCreator[]) => void;
  onVideosChange: (next: PaidVideo[]) => void;
  onEditProgram: () => void;
  /** Program threads (creator-scoped + global) — used for per-creator thread. */
  threads: ProgramThreadComment[];
  onThreadsChange: (next: ProgramThreadComment[]) => void;
  staffName: string;
  /** Brand-wide creator/performance aggregate — sum GMV across all programs
   *  of the same brand when the same creator (by handle/name) is reused. */
  brandAgg?: import('../../lib/paidCollabSchema').BrandCreatorAggregate;
  /** creator_id → program display name, for the cross-program performance
   *  view inside PerformanceModal. */
  programLabelByCreatorId?: Map<string, string>;
  /** Called whenever performance changes in this view, so parents can
   *  re-fetch the brand-wide aggregate. */
  onPerfChanged?: () => void;
}

const CREATOR_STATUSES: CreatorStatus[] = ['active', 'paused', 'done', 'dropped'];

const blankCreatorForm = () => ({
  name: '', handle: '', fee: 0, agreed_videos: 0,
  onboard_date: todayISO(), status: 'active' as CreatorStatus, notes: '',
  paypal_email: '',
  gmv: 0, items_sold: 0, likes: 0, paid_out: false,
});

// Visibility follows the override hierarchy: creator > program > brand > auto.
import { isCreatorPaymentPending, aggBrandGmv, creatorIdentityKey } from '../../lib/paidCollabSchema';

const blankVideoForm = () => ({
  product_id: '' as string,
  tiktok_url: '', ad_code: '', ad_code_authorized: false,
  posted_on: '',
  notes: '',
});

export default function CreatorCards({
  programId, program, brand, currency, launchDate, creators, videos, programProducts, canEdit,
  onCreatorsChange, onVideosChange, onEditProgram,
  threads, onThreadsChange, staffName,
  brandAgg, programLabelByCreatorId, onPerfChanged,
}: Props) {
  // Resolved visibility — creator > program > brand > automatic.
  const isPaymentPending = (c: PaidCreator, live: number) =>
    isCreatorPaymentPending(c, live, program, brand);
  const productById = useMemo(() => {
    const m = new Map<string, BrandProduct>();
    for (const p of programProducts) m.set(p.id, p);
    return m;
  }, [programProducts]);
  // Creator add/edit modal
  const [showCreator, setShowCreator] = useState(false);
  const [editingCreator, setEditingCreator] = useState<PaidCreator | null>(null);
  const [creatorForm, setCreatorForm] = useState(blankCreatorForm());
  const [creatorBusy, setCreatorBusy] = useState(false);
  const [creatorErr, setCreatorErr] = useState<string | null>(null);

  // Per-creator videos modal
  const [videosForCreator, setVideosForCreator] = useState<PaidCreator | null>(null);
  // Per-creator performance modal
  const [perfForCreator, setPerfForCreator] = useState<PaidCreator | null>(null);

  // Per-creator GMV = sum of that creator's WEEKLY performance entries
  // (monthly is excluded to avoid double-counting the same period).
  const [weeklyGmvByCreator, setWeeklyGmvByCreator] = useState<Map<string, number>>(new Map());
  const creatorIdsKey = creators.map(c => c.id).join(',');
  const loadPerformance = async () => {
    if (creators.length === 0) { setWeeklyGmvByCreator(new Map()); return; }
    const { data } = await supabase.from('paid_creator_performance')
      .select('creator_id,gmv')
      .in('creator_id', creators.map(c => c.id))
      .eq('period_type', 'weekly');
    const m = new Map<string, number>();
    (data ?? []).forEach((r: any) => {
      m.set(r.creator_id, (m.get(r.creator_id) ?? 0) + Number(r.gmv || 0));
    });
    setWeeklyGmvByCreator(m);
  };
  useEffect(() => { loadPerformance(); /* eslint-disable-next-line */ }, [creatorIdsKey]);

  const videosByCreator = useMemo(() => {
    const m = new Map<string, PaidVideo[]>();
    for (const v of videos) {
      const arr = m.get(v.creator_id) ?? [];
      arr.push(v);
      m.set(v.creator_id, arr);
    }
    return m;
  }, [videos]);

  const openAddCreator = () => {
    setEditingCreator(null);
    setCreatorForm(blankCreatorForm());
    setCreatorErr(null);
    setShowCreator(true);
  };

  const openEditCreator = (c: PaidCreator) => {
    setEditingCreator(c);
    setCreatorForm({
      name: c.name,
      handle: c.handle ?? '',
      fee: Number(c.fee) || 0,
      agreed_videos: c.agreed_videos,
      onboard_date: c.onboard_date ?? todayISO(),
      status: c.status,
      notes: c.notes ?? '',
      paypal_email: c.paypal_email ?? '',
      gmv: Number(c.gmv) || 0,
      items_sold: c.items_sold,
      likes: c.likes,
      paid_out: !!c.paid_out,
    });
    setCreatorErr(null);
    setShowCreator(true);
  };

  // Quick-toggle "Mark paid" / "Undo paid" straight from the card.
  const [togglingPaidId, setTogglingPaidId] = useState<string | null>(null);
  const togglePaidOut = async (c: PaidCreator) => {
    setTogglingPaidId(c.id);
    const next = !c.paid_out;
    const { data, error } = await supabase.from('paid_creators')
      .update({ paid_out: next, paid_at: next ? new Date().toISOString() : null })
      .eq('id', c.id)
      .select('*').single();
    setTogglingPaidId(null);
    if (error) { alert(error.message); return; }
    onCreatorsChange(creators.map(x => x.id === c.id ? (data as PaidCreator) : x));
  };

  const submitCreator = async (e: FormEvent) => {
    e.preventDefault();
    setCreatorBusy(true); setCreatorErr(null);
    try {
      const payload = {
        name: creatorForm.name.trim(),
        handle: creatorForm.handle.trim() || null,
        fee: Number(creatorForm.fee) || 0,
        agreed_videos: Number(creatorForm.agreed_videos) || 0,
        onboard_date: creatorForm.onboard_date || null,
        status: creatorForm.status,
        notes: creatorForm.notes.trim() || null,
        paypal_email: creatorForm.paypal_email.trim() || null,
        gmv: Number(creatorForm.gmv) || 0,
        items_sold: Number(creatorForm.items_sold) || 0,
        likes: Number(creatorForm.likes) || 0,
        paid_out: creatorForm.paid_out,
        paid_at: creatorForm.paid_out
          ? (editingCreator?.paid_at ?? new Date().toISOString())
          : null,
      };
      if (editingCreator) {
        const { data, error } = await supabase.from('paid_creators')
          .update(payload).eq('id', editingCreator.id).select('*').single();
        if (error) throw error;
        onCreatorsChange(creators.map(c => c.id === editingCreator.id ? (data as PaidCreator) : c));
      } else {
        const { data, error } = await supabase.from('paid_creators')
          .insert({ program_id: programId, ...payload, sort_order: creators.length })
          .select('*').single();
        if (error) throw error;
        onCreatorsChange([...creators, data as PaidCreator]);
      }
      setShowCreator(false);
    } catch (e: any) {
      setCreatorErr(e?.message ?? 'Failed to save creator');
    } finally {
      setCreatorBusy(false);
    }
  };

  const removeCreator = async (c: PaidCreator) => {
    if (!confirm(`Remove ${c.name} from this program? Their videos will also be deleted.`)) return;
    const { error } = await supabase.from('paid_creators').delete().eq('id', c.id);
    if (error) { alert(error.message); return; }
    onCreatorsChange(creators.filter(x => x.id !== c.id));
    onVideosChange(videos.filter(v => v.creator_id !== c.id));
  };

  // Per-creator video counts — every video counts as live.
  const liveCountByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) {
      m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    }
    return m;
  }, [videos]);

  const paymentPendingCreators = useMemo(
    () => creators.filter(c => isPaymentPending(c, liveCountByCreator.get(c.id) ?? 0)),
    [creators, liveCountByCreator],
  );

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h6 className="mb-0">Creators</h6>
        {canEdit && (
          <Button size="sm" onClick={openAddCreator}>
            <i className="bi bi-person-plus me-1" /> Add creator
          </Button>
        )}
      </div>

      {paymentPendingCreators.length > 0 && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <span className="ac-payment-pending-badge">
            <i className="bi bi-cash-stack" style={{ fontSize: '1.3rem' }} />
          </span>
          <div className="flex-grow-1">
            <strong>
              {paymentPendingCreators.length === 1
                ? '1 creator has completed their deliverables — payment is pending'
                : `${paymentPendingCreators.length} creators have completed their deliverables — payment is pending`}
            </strong>
            <div className="small text-muted">
              {paymentPendingCreators.map(c => c.name).join(', ')}
            </div>
          </div>
        </Alert>
      )}

      {creators.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No creators yet — add the first one to start tracking videos.
        </Card>
      ) : (
        <div className="row g-3">
          {creators.map(c => {
            const cv = videosByCreator.get(c.id) ?? [];
            const live = cv.length;
            const pipeline = Math.max(0, c.agreed_videos - live);
            const days = c.onboard_date ? daysBetween(c.onboard_date, todayISO()) : 0;
            const meta = CREATOR_STATUS_META[c.status];
            const progressPct = c.agreed_videos > 0 ? Math.min(100, Math.round((live / c.agreed_videos) * 100)) : 0;
            const paymentPending = isPaymentPending(c, live);
            return (
              <div className="col-md-6 col-xl-4" key={c.id}>
                <Card className={`h-100 ${paymentPending ? 'ac-payment-pending-card' : ''}`}>
                  <Card.Body className="d-flex flex-column">
                    {paymentPending && (
                      <div className="mb-2">
                        <Badge
                          bg=""
                          className="ac-payment-pending-badge w-100 justify-content-center py-2"
                          style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.85rem' }}
                          title="Live videos meet the agreed count — pay this creator and mark as paid."
                        >
                          <i className="bi bi-cash-stack" />
                          Payment pending
                        </Badge>
                        {c.paypal_email && (
                          <div className="small mt-1 text-truncate" title={c.paypal_email}>
                            <i className="bi bi-paypal me-1 text-primary" />
                            <span className="fw-semibold">{c.paypal_email}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="d-flex gap-2 align-items-start">
                      <Avatar name={c.name} size="lg" />
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-semibold text-truncate">{c.name}</div>
                        {c.handle && (
                          <div className="text-muted small text-truncate">
                            <i className="bi bi-at" />{c.handle.replace(/^@/, '')}
                          </div>
                        )}
                      </div>
                      <div className="d-flex flex-column gap-1 align-items-end">
                        <Badge bg="" style={{ backgroundColor: meta.color }}>{meta.label}</Badge>
                        {c.paid_out && (
                          <Badge bg="success" title={c.paid_at ? `Paid on ${new Date(c.paid_at).toLocaleDateString()}` : undefined}>
                            <i className="bi bi-check-circle-fill me-1" />Paid
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="row g-2 mt-3 small">
                      <div className="col-6">
                        <div className="text-muted">Fee</div>
                        <div className="fw-semibold">{fmtMoney(Number(c.fee), currency)}</div>
                      </div>
                      <div className="col-6">
                        <div className="text-muted">Agreed videos</div>
                        <div className="fw-semibold">{c.agreed_videos || '—'}</div>
                      </div>
                      <div className="col-6">
                        <div className="text-muted">Onboard</div>
                        <div className="fw-semibold">
                          {c.onboard_date ? new Date(c.onboard_date + 'T00:00:00').toLocaleDateString() : '—'}
                        </div>
                      </div>
                      <div className="col-6">
                        <div className="text-muted">Days in program</div>
                        <div className="fw-semibold">{days}</div>
                      </div>
                    </div>

                    {c.agreed_videos > 0 && (
                      <div className="mt-3">
                        <div className="d-flex justify-content-between small">
                          <span className="text-muted">Deliverables</span>
                          <span>{live}/{c.agreed_videos}</span>
                        </div>
                        <div className="progress" style={{ height: 6 }}>
                          <div
                            className="progress-bar"
                            style={{ width: `${progressPct}%`, backgroundColor: meta.color }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-3 d-flex gap-2 flex-wrap">
                      <Badge bg="warning" text="dark">
                        <i className="bi bi-hourglass-split me-1" />{pipeline} pipeline
                      </Badge>
                      <Badge bg="success">
                        <i className="bi bi-broadcast me-1" />{live} live
                      </Badge>
                    </div>

                    {/* Creator performance — brand-wide GMV (sum across every
                        program of the same brand for this creator). */}
                    <div className="mt-2 small">
                      <div className="text-center p-2 rounded" style={{ background: 'rgba(32, 201, 151, 0.1)' }}>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                          <i className="bi bi-cash-coin me-1" />GMV
                          <span className="ms-1 text-muted" style={{ fontSize: '.6rem' }}>(brand-wide)</span>
                        </div>
                        <div className="fw-bold" style={{ color: '#198754' }}>
                          {fmtMoney(
                            brandAgg ? aggBrandGmv(c, brandAgg, 'weekly') : (weeklyGmvByCreator.get(c.id) ?? 0),
                            currency,
                          )}
                        </div>
                      </div>
                    </div>

                    {c.notes && (
                      <div className="mt-2 small text-muted" style={{ whiteSpace: 'pre-wrap' }}>
                        {c.notes}
                      </div>
                    )}

                    <div className="d-flex gap-2 mt-auto pt-3 border-top flex-wrap">
                      <Button size="sm" variant="outline-primary" className="flex-grow-1"
                        onClick={() => setVideosForCreator(c)}>
                        <i className="bi bi-collection-play me-1" /> Videos ({cv.length})
                      </Button>
                      <Button size="sm" variant="outline-secondary"
                        onClick={() => setPerfForCreator(c)}
                        title="Update weekly / monthly performance">
                        <i className="bi bi-graph-up-arrow me-1" /> Performance
                      </Button>
                      {canEdit && paymentPending && (
                        <Button size="sm" variant="success" className="fw-semibold"
                          disabled={togglingPaidId === c.id}
                          onClick={() => togglePaidOut(c)}
                          title="Mark this creator as paid">
                          {togglingPaidId === c.id
                            ? <Spinner size="sm" animation="border" />
                            : <><i className="bi bi-check-circle me-1" />Mark paid</>}
                        </Button>
                      )}
                      {canEdit && c.paid_out && (
                        <Button size="sm" variant="outline-success"
                          disabled={togglingPaidId === c.id}
                          onClick={() => togglePaidOut(c)}
                          title="Mark as unpaid">
                          {togglingPaidId === c.id
                            ? <Spinner size="sm" animation="border" />
                            : <><i className="bi bi-arrow-counterclockwise me-1" />Undo paid</>}
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          <Button size="sm" variant="outline-secondary" onClick={() => openEditCreator(c)} title="Edit">
                            <i className="bi bi-pencil" />
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => removeCreator(c)} title="Remove">
                            <i className="bi bi-trash" />
                          </Button>
                        </>
                      )}
                    </div>
                  </Card.Body>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Creator add/edit modal */}
      <Modal show={showCreator} onHide={() => setShowCreator(false)} centered>
        <Form onSubmit={submitCreator}>
          <Modal.Header closeButton>
            <Modal.Title>{editingCreator ? 'Edit creator' : 'Add creator'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {creatorErr && <Alert variant="danger">{creatorErr}</Alert>}
            <div className="row g-2">
              <Form.Group className="col-md-7 mb-2">
                <Form.Label>Name</Form.Label>
                <Form.Control required value={creatorForm.name}
                  onChange={e => setCreatorForm({ ...creatorForm, name: e.target.value })} />
              </Form.Group>
              <Form.Group className="col-md-5 mb-2">
                <Form.Label>TikTok handle</Form.Label>
                <Form.Control value={creatorForm.handle} placeholder="@username"
                  onChange={e => setCreatorForm({ ...creatorForm, handle: e.target.value })} />
              </Form.Group>
              <Form.Group className="col-md-4 mb-2">
                <Form.Label>Fee ({currency})</Form.Label>
                <NumberInput min={0} step="any"
                  value={creatorForm.fee}
                  onChange={n => setCreatorForm({ ...creatorForm, fee: n })} />
              </Form.Group>
              <Form.Group className="col-md-4 mb-2">
                <Form.Label>Agreed videos</Form.Label>
                <NumberInput min={0}
                  value={creatorForm.agreed_videos}
                  onChange={n => setCreatorForm({ ...creatorForm, agreed_videos: n })} />
              </Form.Group>
              <Form.Group className="col-md-4 mb-2">
                <Form.Label>Status</Form.Label>
                <Form.Select value={creatorForm.status}
                  onChange={e => setCreatorForm({ ...creatorForm, status: e.target.value as CreatorStatus })}>
                  {CREATOR_STATUSES.map(s => (
                    <option key={s} value={s}>{CREATOR_STATUS_META[s].label}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-6 mb-2">
                <Form.Label>Onboard date</Form.Label>
                <Form.Control type="date" value={creatorForm.onboard_date}
                  onChange={e => setCreatorForm({ ...creatorForm, onboard_date: e.target.value })} />
                {launchDate && (
                  <Form.Text className="text-muted">Program launched {new Date(launchDate + 'T00:00:00').toLocaleDateString()}</Form.Text>
                )}
              </Form.Group>
              <Form.Group className="col-12 mb-2">
                <Form.Label>
                  <i className="bi bi-paypal me-1" />PayPal email
                  <span className="text-muted ms-2 small">(optional — shown to the client when payment is pending)</span>
                </Form.Label>
                <Form.Control type="email" placeholder="creator@example.com"
                  value={creatorForm.paypal_email}
                  onChange={e => setCreatorForm({ ...creatorForm, paypal_email: e.target.value })} />
              </Form.Group>
            </div>

            {/* Payment status only makes sense on an existing creator.
                GMV / items sold now live behind the Performance button. */}
            {editingCreator && (
              <>
                <hr className="my-2" />
                <Form.Group className="mb-2">
                  <Form.Check
                    type="switch"
                    id="creator-paid-out"
                    label={
                      <span>
                        <i className="bi bi-cash-stack me-1" />
                        <strong>Marked as paid</strong>
                        <span className="text-muted ms-2 small">
                          — turn this on once you've paid the creator their fee.
                        </span>
                      </span>
                    }
                    checked={creatorForm.paid_out}
                    onChange={e => setCreatorForm({ ...creatorForm, paid_out: e.target.checked })}
                  />
                </Form.Group>
              </>
            )}

            <Form.Group className="mb-1">
              <Form.Label>Notes</Form.Label>
              <Form.Control as="textarea" rows={2} value={creatorForm.notes}
                onChange={e => setCreatorForm({ ...creatorForm, notes: e.target.value })} />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowCreator(false)} disabled={creatorBusy}>Cancel</Button>
            <Button type="submit" disabled={creatorBusy || !creatorForm.name.trim()}>
              {creatorBusy ? 'Saving…' : (editingCreator ? 'Save' : 'Add creator')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Per-creator videos modal */}
      {videosForCreator && (
        <CreatorVideosModal
          creator={videosForCreator}
          videos={videos.filter(v => v.creator_id === videosForCreator.id)}
          currency={currency}
          canEdit={canEdit}
          programProducts={programProducts}
          productById={productById}
          programId={programId}
          threads={threads.filter(t => t.creator_id === videosForCreator.id)}
          staffName={staffName}
          onThreadAdded={(c) => onThreadsChange([...threads, c])}
          onClose={() => setVideosForCreator(null)}
          onEditProgram={() => { setVideosForCreator(null); onEditProgram(); }}
          onChange={(updated) => {
            // Replace this creator's videos in the global list
            const others = videos.filter(v => v.creator_id !== videosForCreator.id);
            onVideosChange([...others, ...updated]);
          }}
        />
      )}

      {/* Per-creator performance modal — pulls every sibling-creator-row in
          the brand (same handle/name) so cross-program entries show up here. */}
      {perfForCreator && (() => {
        const siblings = brandAgg
          ? (brandAgg.creatorsByIdentity.get(creatorIdentityKey(perfForCreator)) ?? [])
              .map(c => c.id)
          : undefined;
        return (
          <PerformanceModal
            entityLabel={perfForCreator.name}
            perfTable="paid_creator_performance"
            fkColumn="creator_id"
            entityId={perfForCreator.id}
            siblingEntityIds={siblings}
            programLabelByEntityId={programLabelByCreatorId}
            anchorTable="paid_creators"
            anchorValue={perfForCreator.weekly_perf_anchor}
            currency={currency}
            canEdit={canEdit}
            onClose={() => { setPerfForCreator(null); loadPerformance(); onPerfChanged?.(); }}
            onAnchorSet={(anchor) => {
              const cid = perfForCreator.id;
              onCreatorsChange(creators.map(c =>
                c.id === cid ? { ...c, weekly_perf_anchor: anchor } : c));
              setPerfForCreator(prev =>
                prev && prev.id === cid ? { ...prev, weekly_perf_anchor: anchor } : prev);
            }}
          />
        );
      })()}
    </>
  );
}

// =====================================================================
// Per-creator videos modal — list + add/edit/delete videos
// =====================================================================

interface VideosModalProps {
  creator: PaidCreator;
  videos: PaidVideo[];
  currency: string;
  canEdit: boolean;
  programProducts: BrandProduct[];
  productById: Map<string, BrandProduct>;
  programId: string;
  threads: ProgramThreadComment[];
  staffName: string;
  onThreadAdded: (c: ProgramThreadComment) => void;
  onClose: () => void;
  onEditProgram: () => void;
  onChange: (next: PaidVideo[]) => void;
}

function CreatorVideosModal({
  creator, videos, currency, canEdit, programProducts, productById,
  programId, threads, staffName, onThreadAdded,
  onClose, onEditProgram, onChange,
}: VideosModalProps) {
  const [editing, setEditing] = useState<PaidVideo | null>(null);
  const [form, setForm] = useState(blankVideoForm());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm({
      ...blankVideoForm(),
      // Pre-select the single program product if there's only one
      product_id: programProducts.length === 1 ? programProducts[0].id : '',
    });
    setAdding(true);
    setErr(null);
  };
  const openEdit = (v: PaidVideo) => {
    setEditing(v);
    setForm({
      product_id: v.product_id ?? '',
      tiktok_url: v.tiktok_url ?? '',
      ad_code: v.ad_code ?? '',
      ad_code_authorized: !!v.ad_code_authorized,
      posted_on: v.posted_on ?? '',
      notes: v.notes ?? '',
    });
    setAdding(true);
    setErr(null);
  };

  // Copy-to-clipboard with brief per-item feedback.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Ad-code authorization quick toggle (per-video pending state).
  const [togglingAuth, setTogglingAuth] = useState<string | null>(null);
  const toggleAuthorized = async (v: PaidVideo) => {
    if (!canEdit || !v.ad_code || togglingAuth) return;
    const next = !v.ad_code_authorized;
    setTogglingAuth(v.id);
    // Optimistic update — flip first, roll back on error.
    onChange(videos.map(x => x.id === v.id ? { ...x, ad_code_authorized: next } : x));
    const { error } = await supabase.from('paid_creator_videos')
      .update({ ad_code_authorized: next }).eq('id', v.id);
    if (error) {
      onChange(videos.map(x => x.id === v.id ? { ...x, ad_code_authorized: !next } : x));
      alert(error.message);
    }
    setTogglingAuth(null);
  };
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(k => (k === key ? null : k)), 1500);
    }).catch(() => {/* clipboard unavailable — ignore */});
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.product_id) {
      setErr('Pick which product this video was created for.');
      return;
    }
    setBusy(true); setErr(null);
    try {
      // Every video is live the moment it's added; default posted_on to today.
      const adCode = form.ad_code.trim() || null;
      const payload = {
        product_id: form.product_id,
        tiktok_url: form.tiktok_url.trim() || null,
        ad_code: adCode,
        // Authorization only means something when an ad code exists.
        ad_code_authorized: adCode ? form.ad_code_authorized : false,
        status: 'live' as VideoStatus,
        posted_on: form.posted_on || todayISO(),
        notes: form.notes.trim() || null,
      };
      if (editing) {
        const { data, error } = await supabase.from('paid_creator_videos')
          .update(payload).eq('id', editing.id).select('*').single();
        if (error) throw error;
        onChange(videos.map(v => v.id === editing.id ? (data as PaidVideo) : v));
      } else {
        const { data, error } = await supabase.from('paid_creator_videos')
          .insert({ creator_id: creator.id, ...payload })
          .select('*').single();
        if (error) throw error;
        onChange([...videos, data as PaidVideo]);
      }
      setAdding(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save video');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: PaidVideo) => {
    if (!confirm('Delete this video?')) return;
    const { error } = await supabase.from('paid_creator_videos').delete().eq('id', v.id);
    if (error) { alert(error.message); return; }
    onChange(videos.filter(x => x.id !== v.id));
  };

  const sorted = [...videos].sort((a, b) => {
    // live last, then by posted_on / created_at desc
    if (a.status !== b.status) return a.status === 'pipeline' ? -1 : 1;
    return (b.posted_on ?? b.created_at).localeCompare(a.posted_on ?? a.created_at);
  });

  return (
    <>
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-collection-play me-2" />
          {creator.name} — videos
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {!adding && (
          <>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="text-muted small">
                {videos.length} live · {Math.max(0, creator.agreed_videos - videos.length)} in pipeline
                {' '}<span className="text-muted">(of {creator.agreed_videos} agreed)</span>
              </div>
              {canEdit && (
                <Button size="sm" onClick={openAdd}>
                  <i className="bi bi-plus-lg me-1" /> Add video
                </Button>
              )}
            </div>
            {sorted.length === 0 ? (
              <div className="text-muted text-center py-4 small">No videos yet for this creator.</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {sorted.map(v => {
                  const prod = v.product_id ? productById.get(v.product_id) : null;
                  return (
                  <div key={v.id} className="border rounded p-2 d-flex gap-2 align-items-start">
                    <div
                      className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                      style={{ width: 36, height: 36, backgroundColor: '#198754' }}
                      title="Live"
                    >
                      <i className="bi bi-broadcast" />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        {prod ? (
                          <Badge bg="primary"><i className="bi bi-tag-fill me-1" />{prod.name}</Badge>
                        ) : v.product_id ? (
                          <Badge bg="secondary"><i className="bi bi-tag me-1" />Removed product</Badge>
                        ) : (
                          <Badge bg="light" text="dark" className="border">
                            <i className="bi bi-exclamation-circle me-1" />No product
                          </Badge>
                        )}
                        {v.posted_on && (
                          <Badge bg="light" text="dark" className="border">
                            {new Date(v.posted_on + 'T00:00:00').toLocaleDateString()}
                          </Badge>
                        )}
                      </div>

                      {/* TikTok URL row — link + copy */}
                      {v.tiktok_url ? (
                        <div className="d-flex align-items-center gap-1 mt-1 min-w-0">
                          <i className="bi bi-tiktok flex-shrink-0" />
                          <a href={v.tiktok_url} target="_blank" rel="noreferrer"
                            className="text-truncate small" style={{ minWidth: 0 }}>
                            {v.tiktok_url}
                          </a>
                          <button type="button"
                            className="btn btn-sm btn-link p-0 ms-1 flex-shrink-0 text-decoration-none"
                            title="Copy video link"
                            onClick={() => copy(v.tiktok_url!, `url-${v.id}`)}>
                            <i className={`bi ${copiedKey === `url-${v.id}` ? 'bi-check-lg text-success' : 'bi-clipboard'}`} />
                          </button>
                        </div>
                      ) : (
                        <div className="text-muted small fst-italic mt-1">No URL yet</div>
                      )}

                      {/* Ad code row — code + copy + authorized status */}
                      {v.ad_code && (
                        <div className="d-flex align-items-center gap-1 mt-1 min-w-0 flex-wrap">
                          <i className="bi bi-upc-scan flex-shrink-0 text-muted" />
                          <code className="text-truncate small" style={{ minWidth: 0 }}>{v.ad_code}</code>
                          <button type="button"
                            className="btn btn-sm btn-link p-0 ms-1 flex-shrink-0 text-decoration-none"
                            title="Copy ad code"
                            onClick={() => copy(v.ad_code!, `ad-${v.id}`)}>
                            <i className={`bi ${copiedKey === `ad-${v.id}` ? 'bi-check-lg text-success' : 'bi-clipboard'}`} />
                          </button>
                          {canEdit ? (
                            <button
                              type="button"
                              className={`btn btn-sm ms-1 py-0 px-2 ${v.ad_code_authorized ? 'btn-success' : 'btn-outline-secondary'}`}
                              style={{ fontSize: '.75rem', lineHeight: 1.5 }}
                              disabled={togglingAuth === v.id}
                              title={v.ad_code_authorized ? 'Click to mark as not authorized' : 'Click to mark as authorized'}
                              onClick={() => toggleAuthorized(v)}
                            >
                              <i className={`bi me-1 ${v.ad_code_authorized ? 'bi-shield-check' : 'bi-shield-exclamation'}`} />
                              {v.ad_code_authorized ? 'Authorized' : 'Not authorized'}
                            </button>
                          ) : v.ad_code_authorized ? (
                            <Badge bg="success" className="ms-1">
                              <i className="bi bi-shield-check me-1" />Authorized
                            </Badge>
                          ) : (
                            <Badge bg="light" text="dark" className="border ms-1">
                              <i className="bi bi-shield-exclamation me-1" />Not authorized
                            </Badge>
                          )}
                        </div>
                      )}

                      {v.notes && <div className="small mt-1 text-muted" style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
                    </div>
                    {canEdit && (
                      <div className="d-flex flex-column gap-1">
                        <button className="btn btn-sm btn-link p-0 text-muted" onClick={() => openEdit(v)} title="Edit">
                          <i className="bi bi-pencil" />
                        </button>
                        <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => remove(v)} title="Delete">
                          <i className="bi bi-trash" />
                        </button>
                      </div>
                    )}
                  </div>
                );})}
              </div>
            )}

            {/* Per-creator conversation thread */}
            <div className="mt-4">
              <div className="fw-semibold mb-2">
                <i className="bi bi-chat-left-text me-2" />
                Conversation about {creator.name}
              </div>
              <ProgramThreadPanel
                comments={threads}
                mode="staff"
                currentAuthorName={staffName}
                canPost={canEdit}
                onAdd={async (body, name, parentId) => {
                  const { data, error } = await supabase.from('paid_program_threads').insert({
                    program_id: programId,
                    creator_id: creator.id,
                    author_type: 'staff',
                    author_name: name,
                    body,
                    parent_id: parentId ?? null,
                  }).select('*').single();
                  if (error) throw error;
                  onThreadAdded(data as ProgramThreadComment);
                }}
              />
            </div>
          </>
        )}

        {adding && canEdit && (
          <Form onSubmit={submit}>
            {err && <Alert variant="danger">{err}</Alert>}
            {programProducts.length === 0 ? (
              <Alert variant="warning" className="d-flex align-items-center justify-content-between gap-2 py-2">
                <div>
                  <i className="bi bi-exclamation-triangle me-1" />
                  No products are attached to this program yet. Each video must reference a product, so add one to the program first.
                </div>
                <Button size="sm" variant="outline-warning" onClick={() => { setAdding(false); onEditProgram(); }}>
                  <i className="bi bi-pencil me-1" /> Edit program
                </Button>
              </Alert>
            ) : (
              <Form.Group className="mb-2">
                <Form.Label>Product *</Form.Label>
                <Form.Select
                  required
                  value={form.product_id}
                  onChange={e => setForm({ ...form, product_id: e.target.value })}
                >
                  <option value="">— Pick a product —</option>
                  {programProducts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  Only products attached to this program appear here. <a href="#" onClick={(e) => { e.preventDefault(); setAdding(false); onEditProgram(); }}>Edit program</a> to add more.
                </Form.Text>
              </Form.Group>
            )}
            <Form.Group className="mb-2">
              <Form.Label>TikTok URL</Form.Label>
              <Form.Control type="url" value={form.tiktok_url}
                onChange={e => setForm({ ...form, tiktok_url: e.target.value })}
                placeholder="https://www.tiktok.com/@user/video/123…" />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Video ad code <small className="text-muted fw-normal">(optional)</small></Form.Label>
              <Form.Control value={form.ad_code}
                onChange={e => setForm({ ...form, ad_code: e.target.value })}
                placeholder="e.g. #v09abc123…"
                style={{ fontFamily: 'monospace' }} />
              <Form.Check
                type="switch"
                id="video-ad-code-authorized"
                className="mt-2"
                disabled={!form.ad_code.trim()}
                checked={form.ad_code_authorized}
                onChange={e => setForm({ ...form, ad_code_authorized: e.target.checked })}
                label={
                  <span>
                    <i className={`bi me-1 ${form.ad_code_authorized ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-muted'}`} />
                    <strong>Ad code authorized</strong>
                    <span className="text-muted ms-2 small">
                      {form.ad_code_authorized
                        ? '— this ad code is approved for use.'
                        : '— turn on once the ad code is authorized.'}
                    </span>
                  </span>
                }
              />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Posted on</Form.Label>
              <Form.Control type="date" value={form.posted_on}
                onChange={e => setForm({ ...form, posted_on: e.target.value })} />
              <Form.Text className="text-muted">
                Added videos count as live. Defaults to today if left empty.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Notes</Form.Label>
              <Form.Control as="textarea" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || programProducts.length === 0 || !form.product_id}>
                {busy ? 'Saving…' : (editing ? 'Save' : 'Add video')}
              </Button>
            </div>
          </Form>
        )}
      </Modal.Body>
      {!adding && (
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </Modal.Footer>
      )}
    </Modal>
    </>
  );
}
