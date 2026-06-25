import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Spinner, Alert, Form, InputGroup, Row, Col, Badge, Modal, Button, Tabs, Tab } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, BrandProduct, VideoStatus, CreatorStatus,
  CREATOR_STATUS_META, isCreatorPaymentPending, programDisplayName,
  fmtMoney, fmtNumber, todayISO, creatorIdentityKey,
} from '../../lib/paidCollabSchema';
import Avatar from '../../components/Avatar';
import PerformanceModal from '../../components/paidcollab/PerformanceModal';
import NumberInput from '../../components/NumberInput';
import { useAuth } from '../../auth/AuthContext';

const CREATOR_STATUS_VALUES: CreatorStatus[] = ['active', 'paused', 'done', 'dropped'];

import { useClientPaidCollabData, Brand } from './useClientPaidCollabData';
import * as store from '../handler-collab/store';
import { copyWithToast } from '../../lib/copyToast';
import '../handler-collab/handlerCollab.css';
import './creatorsTable.css';

const CCT_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];
const cctGradient = (name: string) => (name ? CCT_GRADIENTS[name.charCodeAt(0) % CCT_GRADIENTS.length] : CCT_GRADIENTS[0]);
const cctInitials = (name: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const cctIsUrl = (s?: string) => !!s && (s.startsWith('http://') || s.startsWith('https://'));
// This Creators page is shared by the handler AND the client. The handler sees ALL
// pending; the client only sees a creator's "Payment Pending" once the handler toggles
// pending_visible_to_client on (mirrors handlerCollabReadonly.clientStatus). Pass
// revealAll=true for the handler view.
const cctPendingVisible = (c: any, revealAll = false) =>
  c?.payment_status === 'pending' && (revealAll || !!c?.pending_visible_to_client);
// PayPal payout value → openable link (URL / www. / paypal.me). Plain emails stay text.
function cctPaypalUrl(raw?: string | null) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}
function cctCopy(t: string) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { /* ignore */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { /* ignore */ }
}

type StatusFilter = 'all' | 'active' | 'paused' | 'done' | 'dropped';
type PaymentFilter = 'all' | 'pending' | 'paid';

// Compact payout chips for the table row — a PP/Z tag + copy button (+ open ↗ when
// the PayPal value is a link). Mirrors the handler workspace's "Payout" column; never
// prints the raw email/link inline (hover title reveals it, copy puts it on clipboard).
function PayoutChips({ paypal, zelle }: { paypal: string; zelle: string }) {
  if (!paypal && !zelle) return <span className="cct-muted">—</span>;
  const ppUrl = cctPaypalUrl(paypal);
  return (
    <div className="cct-pay-chips">
      {paypal && (
        <span className="cct-paychip" title={paypal}>
          <span className="cct-paytag pp">PP</span>
          <button type="button" className="cct-vcopy" title={`Copy ${ppUrl ? 'link' : 'email'}`}
            onClick={e => { e.stopPropagation(); copyWithToast(ppUrl || paypal, ppUrl ? 'Link' : undefined); }}>
            <i className="bi bi-clipboard" />
          </button>
          {ppUrl && (
            <a className="cct-vopen" href={ppUrl} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()} title="Open link">
              <i className="bi bi-box-arrow-up-right" />
            </a>
          )}
        </span>
      )}
      {zelle && (
        <span className="cct-paychip" title={zelle}>
          <span className="cct-paytag zl">Z</span>
          <button type="button" className="cct-vcopy" title="Copy"
            onClick={e => { e.stopPropagation(); copyWithToast(zelle); }}>
            <i className="bi bi-clipboard" />
          </button>
        </span>
      )}
    </div>
  );
}

export default function PaidCollabCreators() {
  const { brands, programs, creators, videos, loading, err } = useClientPaidCollabData();
  const { profile } = useAuth();
  // Handlers see every pending creator; clients only see pending that's toggled visible.
  const revealPending = profile?.role === 'paid_collab_handler';

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all');

  // Creator popup — full videos/details modal, opened from the expanded row.
  const [openCreator, setOpenCreator] = useState<PaidCreator | null>(null);
  // Which table row is expanded inline.
  const [openId, setOpenId] = useState<string | null>(null);
  // Client "mark payment as done" — local overrides + busy state (the hook has no setter).
  const [paidOverride, setPaidOverride] = useState<Record<string, { at: string | null; name: string | null }>>({});
  const [paidBusy, setPaidBusy] = useState<string | null>(null);
  const confirmPaid = async (creatorId: string, confirmed: boolean) => {
    setPaidBusy(creatorId);
    try {
      const updated = await store.setClientPaid(creatorId, confirmed);
      setPaidOverride(prev => ({ ...prev, [creatorId]: { at: updated.client_paid_confirmed_at ?? null, name: updated.client_paid_confirmed_name ?? null } }));
    } catch (e: any) {
      alert(e?.message ?? 'Failed to update payment');
    } finally {
      setPaidBusy(null);
    }
  };

  // Lookup maps
  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    for (const b of brands) m.set(b.id, b);
    return m;
  }, [brands]);
  const programById = useMemo(() => {
    const m = new Map<string, PaidProgram>();
    for (const p of programs) m.set(p.id, p);
    return m;
  }, [programs]);
  // Every video counts as live; pipeline = agreed videos not yet delivered.
  const liveByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) {
      m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    }
    return m;
  }, [videos]);
  const pipelineByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of creators) {
      if (c.status === 'dropped') continue;
      m.set(c.id, Math.max(0, (c.agreed_videos || 0) - (liveByCreator.get(c.id) ?? 0)));
    }
    return m;
  }, [creators, liveByCreator]);

  // Programs limited to currently-selected brand
  const programOptions = useMemo(() => {
    if (!brandFilter) return programs;
    return programs.filter(p => p.brand_id === brandFilter);
  }, [programs, brandFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return creators.filter(c => {
      const prog = programById.get(c.program_id);
      if (!prog) return false;
      if (brandFilter && prog.brand_id !== brandFilter) return false;
      if (programFilter && c.program_id !== programFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      const b = brandById.get(prog.brand_id) ?? null;
      if (paymentFilter === 'pending' && !cctPendingVisible(c, revealPending)) return false;
      if (paymentFilter === 'paid' && !c.paid_out) return false;
      if (q) {
        const hay = `${c.name} ${c.handle ?? ''} ${b?.name ?? ''} ${programDisplayName(prog)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [creators, programById, brandById, brandFilter, programFilter, statusFilter, paymentFilter, search, revealPending]);

  // Order rows by payment state: pending first, then "remaining", paid last.
  // Stable sort keeps the original order inside each group.
  const displayed = useMemo(() => {
    const rank = (c: PaidCreator) =>
      cctPendingVisible(c, revealPending) ? 0 : (c.paid_out ? 2 : 1);
    return [...filtered].sort((a, b) => rank(a) - rank(b));
  }, [filtered, revealPending]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const totalPending = creators.filter(c => cctPendingVisible(c, revealPending)).length;

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2 className="mb-0">Creators</h2>
          {totalPending > 0 && (
            <span className="ac-payment-pending-badge d-inline-flex align-items-center gap-2 px-2 py-1 rounded"
                  style={{ backgroundColor: '#e8862e', color: '#fff' }}>
              <i className="bi bi-cash-stack" />
              <strong>{totalPending} payment{totalPending === 1 ? '' : 's'} pending</strong>
            </span>
          )}
        </div>
      </div>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-center">
            <Col md>
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control
                  placeholder="Search by creator, handle, brand, or program…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setSearch('')}>
                    <i className="bi bi-x-lg" />
                  </button>
                )}
              </InputGroup>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={brandFilter}
                onChange={e => { setBrandFilter(e.target.value); setProgramFilter(''); }}>
                <option value="">All brands</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={programFilter}
                onChange={e => setProgramFilter(e.target.value)}>
                <option value="">All programs</option>
                {programOptions.map(p => (
                  <option key={p.id} value={p.id}>{programDisplayName(p)}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="done">Done</option>
                <option value="dropped">Dropped</option>
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={paymentFilter}
                onChange={e => setPaymentFilter(e.target.value as PaymentFilter)}>
                <option value="all">All payments</option>
                <option value="pending">Payment pending</option>
                <option value="paid">Paid</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {creators.length === 0 ? (
        <Card body className="text-center text-muted py-5">
          <i className="bi bi-people fs-1 d-block mb-2 opacity-50" />
          No creators yet across your brands.
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center">
          No creators match your filters.
        </Card>
      ) : (
        <div className="cct">
          <div className="cct-head">
            <div className="cct-num">#</div>
            <div>Creator</div>
            <div>Brand · Program</div>
            <div>Progress</div>
            <div className="cct-num">Deal</div>
            <div>Payout</div>
            <div>Status</div>
            <div />
          </div>
          {displayed.map((c, i) => {
            const prog = programById.get(c.program_id);
            if (!prog) return null;
            const b = brandById.get(prog.brand_id);
            const live = liveByCreator.get(c.id) ?? 0;
            const pipeline = pipelineByCreator.get(c.id) ?? 0;
            const pending = cctPendingVisible(c, revealPending);
            const meta = CREATOR_STATUS_META[c.status];
            const agreed = c.agreed_videos || 0;
            const progressPct = agreed > 0 ? Math.min(100, Math.round((live / agreed) * 100)) : 0;
            const currency = prog.currency || 'USD';
            const open = openId === c.id;
            const handle = c.handle ? `@${c.handle.replace(/^@/, '')}` : '';
            // raw passthrough (see useClientPaidCollabData) — video links + ad codes + payout
            const cc = c as any;
            const videoCodes: { video?: string; adCode?: string; auth?: boolean }[] =
              Array.isArray(cc.video_codes) ? cc.video_codes : [];
            const paypal: string = cc.paypal || '';
            const zelle: string = cc.zelle || '';
            const ppUrl = cctPaypalUrl(paypal);
            const statusPill = (
              <span className="cct-pill" style={{ background: meta.color + '1A', color: meta.color }}>
                <span className="dot" />{meta.label}
              </span>
            );
            const tags = (
              <>
                {c.paid_out && <span className="cct-paid"><i className="bi bi-check-circle-fill" />Paid</span>}
                {pending && <span className="cct-pendtag"><i className="bi bi-cash-stack" />Pending</span>}
              </>
            );
            return (
              <div className="cct-group" key={c.id}>
                <div
                  className={`cct-row ${open ? 'open' : ''} ${pending ? 'pending' : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => setOpenId(open ? null : c.id)}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenId(open ? null : c.id); }}
                >
                  <div className="cct-cell cct-num"><span className="cct-idx">#{i + 1}</span></div>
                  <div className="cct-cell">
                    <div className="cct-id">
                      <span className="cct-ava" style={{ background: cctGradient(c.name) }}>{cctInitials(c.name)}</span>
                      <div className="cct-idtext">
                        <div className="cct-name">{c.name}</div>
                        <div className="cct-handle">{handle || <span className="cct-muted">no handle</span>}</div>
                      </div>
                    </div>
                  </div>
                  <div className="cct-cell cct-bp">
                    <div className="cct-bp-brand">{b?.name ?? '—'}</div>
                    <div className="cct-bp-prog">{programDisplayName(prog)}</div>
                  </div>
                  <div className="cct-cell cct-prog">
                    {agreed > 0 ? (
                      <>
                        <div className="cct-prog-top"><span>Live</span><span>{live}/{agreed}</span></div>
                        <div className="cct-prog-track"><div className="cct-prog-fill" style={{ width: `${progressPct}%`, background: meta.color }} /></div>
                      </>
                    ) : <span className="cct-muted">{live} live</span>}
                  </div>
                  <div className="cct-cell cct-num"><span className="cct-money">{fmtMoney(Number(c.fee), currency)}</span></div>
                  <div className="cct-cell cct-payout"><PayoutChips paypal={paypal} zelle={zelle} /></div>
                  <div className="cct-cell">
                    <div className="cct-statuscell">{statusPill}{tags}</div>
                  </div>
                  <div className="cct-cell cct-chev">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                  </div>

                  {/* mobile card */}
                  <div className="cct-mc">
                    <div className="cct-mc-head">
                      <span className="cct-ava" style={{ background: cctGradient(c.name) }}>{cctInitials(c.name)}</span>
                      <div className="cct-mc-idblock">
                        <div className="cct-mc-name">{c.name}</div>
                        <div className="cct-mc-sub">{handle || 'no handle'} · {b?.name ?? '—'}</div>
                      </div>
                      <span className="cct-mc-chev">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      </span>
                    </div>
                    <div className="cct-mc-stats">
                      <div className="cct-mc-stat"><b>{fmtMoney(Number(c.fee), currency)}</b><span>Deal</span></div>
                      <div className="cct-mc-stat"><b>{live}/{agreed || live || 0}</b><span>Live</span></div>
                      <div className="cct-mc-stat"><b>{pipeline}</b><span>Pipeline</span></div>
                    </div>
                    <div className="cct-mc-foot cct-statuscell">{statusPill}{tags}<PayoutChips paypal={paypal} zelle={zelle} /></div>
                  </div>
                </div>

                {open && (
                  <div className="cct-expand" onClick={e => e.stopPropagation()}>
                    <div className="cct-expand-inner">
                      <div className="cct-ex-head">
                        <span className="cct-ava" style={{ background: cctGradient(c.name) }}>{cctInitials(c.name)}</span>
                        <div className="cct-idtext">
                          <div className="cct-ex-name">{c.name}</div>
                          <div className="cct-ex-handle">{handle || <span className="cct-muted">no handle</span>}</div>
                        </div>
                      </div>
                      <div className="cct-stats">
                        <div className="cct-stat"><div className="cct-stat-l">Deal</div><div className="cct-stat-v">{fmtMoney(Number(c.fee), currency)}</div></div>
                        <div className="cct-stat"><div className="cct-stat-l">Live videos</div><div className="cct-stat-v green">{live}</div></div>
                        <div className="cct-stat"><div className="cct-stat-l">Pipeline</div><div className="cct-stat-v orange">{pipeline}</div></div>
                        <div className="cct-stat"><div className="cct-stat-l">Agreed</div><div className="cct-stat-v">{agreed || '—'}</div></div>
                        <div className="cct-stat"><div className="cct-stat-l">GMV</div><div className="cct-stat-v green">{fmtMoney(Number(c.gmv) || 0, currency)}</div></div>
                        <div className="cct-stat"><div className="cct-stat-l">Items sold</div><div className="cct-stat-v blue">{fmtNumber(Number(c.items_sold) || 0)}</div></div>
                      </div>
                      <div className="cct-details">
                        <div><div className="cct-dt-l">Brand</div><div className="cct-dt-v">{b?.name ?? '—'}</div></div>
                        <div><div className="cct-dt-l">Program</div><div className="cct-dt-v">{programDisplayName(prog)}</div></div>
                        <div><div className="cct-dt-l">Status</div><div className="cct-dt-v">{meta.label}</div></div>
                        <div><div className="cct-dt-l">Payment</div><div className="cct-dt-v">{c.paid_out ? 'Paid' : pending ? 'Pending' : '—'}</div></div>
                        <div>
                          <div className="cct-dt-l">Payment link</div>
                          <div className="cct-dt-v">
                            {(paypal || zelle) ? (
                              <div className="cct-pay-list">
                                {paypal && (
                                  <span className="cct-pay">
                                    <span className="cct-paytag pp">PP</span>
                                    {ppUrl
                                      ? <a href={ppUrl} target="_blank" rel="noopener noreferrer">{paypal}</a>
                                      : <span>{paypal}</span>}
                                    <button type="button" className="cct-vcopy" title={`Copy ${ppUrl ? 'link' : 'email'}`} onClick={() => copyWithToast(ppUrl || paypal, ppUrl ? 'Link' : undefined)}><i className="bi bi-clipboard" /></button>
                                  </span>
                                )}
                                {zelle && (
                                  <span className="cct-pay">
                                    <span className="cct-paytag zl">Z</span>
                                    <span>{zelle}</span>
                                    <button type="button" className="cct-vcopy" title="Copy" onClick={() => copyWithToast(zelle)}><i className="bi bi-clipboard" /></button>
                                  </span>
                                )}
                              </div>
                            ) : <span className="cct-muted">—</span>}
                          </div>
                        </div>
                      </div>

                      {/* Client "process payment & mark as done" — same GUI as the share
                          link (pc-paynudge). Client view only, while payment-pending. */}
                      {!revealPending && pending && (() => {
                        const ov = paidOverride[c.id];
                        const confirmedAt = ov ? ov.at : ((c as any).client_paid_confirmed_at ?? null);
                        const confirmedName = ov ? ov.name : ((c as any).client_paid_confirmed_name ?? null);
                        const done = !!confirmedAt;
                        const busy = paidBusy === c.id;
                        return (
                          <div className={`pc-paynudge ${done ? 'done' : ''}`}>
                            <div className="pc-paynudge-ic">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                {done ? <path d="M20 6 9 17l-5-5" /> : <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>}
                              </svg>
                            </div>
                            <div className="pc-paynudge-body">
                              <div className="pc-paynudge-title">
                                {done ? 'Payment marked as done' : 'Action needed — process this payment'}
                              </div>
                              <div className="pc-paynudge-text">
                                {done
                                  ? <>Thanks{confirmedName ? `, ${confirmedName}` : ''} — the team has been notified and will verify, then finalize the status.</>
                                  : <>Please process the payment via PayPal{paypal ? <> (<b>{paypal}</b>)</> : ''}, then mark it as done below. The team will cross-check and finalize.</>}
                              </div>
                            </div>
                            <button type="button"
                              className={`pc-paynudge-btn ${done ? 'on' : ''}`}
                              aria-pressed={done}
                              disabled={busy}
                              onClick={() => confirmPaid(c.id, !done)}
                              title={done ? 'Undo — mark as not paid' : 'Mark this payment as done'}>
                              <span className="pc-paynudge-knob" />
                              <span className="pc-paynudge-btn-txt">{busy ? 'Saving…' : done ? 'Marked as paid' : 'Mark as paid'}</span>
                            </button>
                          </div>
                        );
                      })()}

                      <div className="cct-videos">
                        <div className="cct-videos-title">Videos &amp; ad codes{videoCodes.length > 0 && <span className="cct-videos-count">{videoCodes.length}</span>}</div>
                        {videoCodes.length === 0 ? (
                          <div className="cct-muted" style={{ padding: '6px 2px', fontSize: 13 }}>No videos added yet.</div>
                        ) : (
                          <div className="cct-vlist">
                            {videoCodes.map((vc, vi) => {
                              const vOk = cctIsUrl(vc.video);
                              return (
                                <div className={`cct-vrow ${vOk ? 'done' : ''}`} key={vi}>
                                  <span className="cct-vnum">{vi + 1}</span>
                                  <div className="cct-vlink">
                                    {vOk
                                      ? <a href={vc.video} target="_blank" rel="noopener noreferrer" title={vc.video}>{vc.video}</a>
                                      : <span className="cct-muted">No link yet</span>}
                                  </div>
                                  <div className="cct-vcode">
                                    {vc.adCode
                                      ? <>
                                          <code title={vc.adCode}>{vc.adCode}</code>
                                          <button type="button" className="cct-vcopy" title="Copy ad code" onClick={() => cctCopy(vc.adCode || '')}>
                                            <i className="bi bi-clipboard" />
                                          </button>
                                        </>
                                      : <span className="cct-muted">—</span>}
                                  </div>
                                  <span className={`cct-vauth ${vc.auth ? 'on' : ''}`} title={vc.auth ? 'Authorised' : 'Not authorised'}>
                                    {vc.auth ? <i className="bi bi-shield-check" /> : <i className="bi bi-shield" />}
                                  </span>
                                  {vOk && <a className="cct-vopen" href={vc.video} target="_blank" rel="noopener noreferrer" title="Open video"><i className="bi bi-box-arrow-up-right" /></a>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/*
        CreatorPopupModal is DISABLED — the Creators page is now a read-only,
        inline-expand view that reads the current handler_collab_* tables. The popup
        (and its Add / Edit / Bulk-video sub-modals) edited the LEGACY paid_creator_*
        tables and is intentionally not rendered. The component code is kept below for
        reference. `openCreator` / `setOpenCreator` state is retained but unused.

        {openCreator && (() => {
          const op = openCreator;
          const opProg = programById.get(op.program_id) ?? null;
          const opBrandId = opProg?.brand_id ?? '';
          const opBrand = brandById.get(opBrandId) ?? null;
          const brandProgs = programs.filter(p => p.brand_id === opBrandId);
          const brandProgIds = new Set(brandProgs.map(p => p.id));
          const brandCreatorsForOp = creators.filter(c => brandProgIds.has(c.program_id));
          const programLabels = new Map();
          const progNameById = new Map();
          for (const p of brandProgs) progNameById.set(p.id, programDisplayName(p));
          for (const c of brandCreatorsForOp) {
            const n = progNameById.get(c.program_id);
            if (n) programLabels.set(c.id, n);
          }
          return (
            <CreatorPopupModal
              creator={op}
              program={opProg}
              brand={opBrand}
              brandCreators={brandCreatorsForOp}
              programLabelByCreatorId={programLabels}
              onClose={() => setOpenCreator(null)}
              onVideoAdded={() => {}}
              onCreatorDeleted={() => {}}
              onCreatorUpdated={(c) => { setOpenCreator(c); }}
            />
          );
        })()}
      */}
    </>
  );
}

// =====================================================================
// [UNUSED] Creator popup — Overview / Videos tabs (defaults to Videos)
// -----------------------------------------------------------------
// No longer rendered: the Creators page is read-only and reads the current
// handler_collab_* tables, while this popup (and the ManualAddVideoModal /
// EditCreatorModal / BulkAddVideoModal sub-modals below) read & WRITE the LEGACY
// paid_creator_* tables. Kept for reference / possible future re-enable.
// =====================================================================
function CreatorPopupModal({
  creator, program, brand, brandCreators, programLabelByCreatorId,
  onClose, onVideoAdded, onCreatorDeleted, onCreatorUpdated,
}: {
  creator: PaidCreator;
  program: PaidProgram | null;
  brand: Brand | null;
  /** Every creator in this brand (any program) — for cross-program performance. */
  brandCreators?: PaidCreator[];
  /** creator_id → program label, for the Program column in PerformanceModal. */
  programLabelByCreatorId?: Map<string, string>;
  onClose: () => void;
  onVideoAdded: (v: PaidVideo) => void;
  onCreatorDeleted?: (id: string) => void;
  onCreatorUpdated?: (c: PaidCreator) => void;
}) {
  const [tab, setTab] = useState<'overview' | 'videos'>('videos');
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [programProductIds, setProgramProductIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Add-video flow: pick mode → manual form or bulk
  const [pickMode, setPickMode] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  // Per-video ad-auth toggle pending state.
  const [togglingAuth, setTogglingAuth] = useState<string | null>(null);
  // Per-video delete pending state.
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  // Creator delete pending state.
  const [deletingCreator, setDeletingCreator] = useState(false);
  // Performance modal toggle.
  const [perfOpen, setPerfOpen] = useState(false);
  // Mark-paid toggle pending state.
  const [togglingPaid, setTogglingPaid] = useState(false);
  // Edit creator modal toggle + local creator copy so updates show in popup.
  const [editOpen, setEditOpen] = useState(false);
  const [creatorLocal, setCreatorLocal] = useState<PaidCreator>(creator);
  useEffect(() => { setCreatorLocal(creator); }, [creator.id]);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const [vRes, ppRes] = await Promise.all([
          supabase.from('paid_creator_videos').select('*')
            .eq('creator_id', creator.id).order('created_at', { ascending: false }),
          program
            ? supabase.from('paid_program_products').select('product_id').eq('program_id', program.id)
            : Promise.resolve({ data: [], error: null } as any),
        ]);
        if (vRes.error) throw vRes.error;
        if (ppRes.error) throw ppRes.error;
        setVideos((vRes.data as PaidVideo[]) ?? []);
        const ppIds = ((ppRes.data ?? []) as { product_id: string }[]).map(r => r.product_id);
        setProgramProductIds(ppIds);
        if (ppIds.length > 0) {
          const { data: prodRows, error: prodErr } = await supabase
            .from('brand_products').select('*').in('id', ppIds);
          if (prodErr) throw prodErr;
          setProducts((prodRows as BrandProduct[]) ?? []);
        } else {
          setProducts([]);
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load creator data');
      } finally {
        setLoading(false);
      }
    })();
  }, [creator.id, program?.id]);

  const productById = useMemo(() => {
    const m = new Map<string, BrandProduct>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const toggleVideoAuth = async (v: PaidVideo) => {
    if (!v.ad_code || togglingAuth) return;
    const next = !v.ad_code_authorized;
    setTogglingAuth(v.id);
    // Optimistic — flip first, roll back on error.
    setVideos(prev => prev.map(x => x.id === v.id ? { ...x, ad_code_authorized: next } : x));
    const { error } = await supabase.from('paid_creator_videos')
      .update({ ad_code_authorized: next }).eq('id', v.id);
    if (error) {
      setVideos(prev => prev.map(x => x.id === v.id ? { ...x, ad_code_authorized: !next } : x));
      alert(error.message);
    }
    setTogglingAuth(null);
  };

  const deleteVideo = async (v: PaidVideo) => {
    if (!confirm('Delete this video?')) return;
    setDeletingVideoId(v.id);
    const { error } = await supabase.from('paid_creator_videos').delete().eq('id', v.id);
    setDeletingVideoId(null);
    if (error) { alert(error.message); return; }
    setVideos(prev => prev.filter(x => x.id !== v.id));
  };

  const deleteCreator = async () => {
    if (!confirm(`Remove ${creatorLocal.name} from this program? Their videos will also be deleted.`)) return;
    setDeletingCreator(true);
    const { error } = await supabase.from('paid_creators').delete().eq('id', creatorLocal.id);
    setDeletingCreator(false);
    if (error) { alert(error.message); return; }
    onCreatorDeleted?.(creatorLocal.id);
    onClose();
  };

  const togglePaidOut = async () => {
    const next = !creatorLocal.paid_out;
    setTogglingPaid(true);
    const { data, error } = await supabase.from('paid_creators')
      .update({ paid_out: next, paid_at: next ? new Date().toISOString() : null })
      .eq('id', creatorLocal.id)
      .select('*').single();
    setTogglingPaid(false);
    if (error) { alert(error.message); return; }
    const updated = data as PaidCreator;
    setCreatorLocal(updated);
    onCreatorUpdated?.(updated);
  };

  const liveCount = videos.length;
  const paymentPending = isCreatorPaymentPending(creatorLocal, liveCount, program, brand);
  const meta = CREATOR_STATUS_META[creatorLocal.status];

  return (
    <>
      <Modal show onHide={onClose} centered size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title className="d-flex align-items-center gap-2">
            <Avatar name={creatorLocal.name} size="md" />
            <div>
              <div className="fw-bold">
                {creatorLocal.name}
                {creatorLocal.paid_out && (
                  <Badge bg="success" className="ms-2" title={creatorLocal.paid_at ? `Paid on ${new Date(creatorLocal.paid_at).toLocaleDateString()}` : undefined}>
                    <i className="bi bi-check-circle-fill me-1" />Paid
                  </Badge>
                )}
              </div>
              {creatorLocal.handle && (
                <div className="text-muted small">
                  <i className="bi bi-at" />{creatorLocal.handle.replace(/^@/, '')}
                </div>
              )}
            </div>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          {paymentPending && (
            <div className="mb-3">
              <Badge bg="" className="ac-payment-pending-badge w-100 justify-content-center py-2"
                style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.85rem' }}>
                <i className="bi bi-cash-stack me-1" />Payment pending
              </Badge>
              {creatorLocal.paypal_email && (
                <div className="small mt-1 text-truncate" title={creatorLocal.paypal_email}>
                  <i className="bi bi-paypal me-1 text-primary" />
                  <span className="fw-semibold">{creatorLocal.paypal_email}</span>
                </div>
              )}
            </div>
          )}
          <Tabs activeKey={tab} onSelect={(k) => setTab((k as 'overview' | 'videos') ?? 'videos')} className="mb-3">
            <Tab eventKey="videos" title={<><i className="bi bi-collection-play me-1" />Videos ({videos.length})</>}>
              {loading ? (
                <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
              ) : (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <div className="text-muted small">
                      {videos.length} live · {Math.max(0, creatorLocal.agreed_videos - videos.length)} in pipeline (of {creatorLocal.agreed_videos} agreed)
                    </div>
                    <Button size="sm" onClick={() => setPickMode(true)}>
                      <i className="bi bi-plus-lg me-1" />Add video
                    </Button>
                  </div>
                  {videos.length === 0 ? (
                    <p className="text-muted text-center py-4 small mb-0">No videos yet for this creator.</p>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {videos.map(v => {
                        const prod = v.product_id ? productById.get(v.product_id) : null;
                        return (
                          <div key={v.id} className="border rounded p-2 d-flex gap-2 align-items-start">
                            <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                              style={{ width: 36, height: 36, backgroundColor: '#198754' }}>
                              <i className="bi bi-broadcast" />
                            </div>
                            <div className="flex-grow-1 min-w-0">
                              <div className="d-flex align-items-center gap-2 flex-wrap">
                                {prod ? (
                                  <Badge bg="primary"><i className="bi bi-tag-fill me-1" />{prod.name}</Badge>
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
                              {v.tiktok_url ? (
                                <div className="mt-1">
                                  <a href={v.tiktok_url} target="_blank" rel="noreferrer"
                                    className="small text-truncate d-inline-block" style={{ maxWidth: '100%' }}>
                                    <i className="bi bi-tiktok me-1" />{v.tiktok_url}
                                  </a>
                                </div>
                              ) : (
                                <div className="text-muted small fst-italic mt-1">No URL yet</div>
                              )}
                              {v.ad_code && (
                                <div className="d-flex align-items-center gap-1 mt-1 flex-wrap">
                                  <i className="bi bi-upc-scan text-muted" />
                                  <code className="small text-truncate" style={{ maxWidth: 220 }}>{v.ad_code}</code>
                                  <button type="button"
                                    className={`btn btn-sm ms-1 py-0 px-2 ${v.ad_code_authorized ? 'btn-success' : 'btn-outline-secondary'}`}
                                    style={{ fontSize: '.75rem', lineHeight: 1.5 }}
                                    disabled={togglingAuth === v.id}
                                    title={v.ad_code_authorized ? 'Click to mark as not authorized' : 'Click to mark as authorized'}
                                    onClick={() => toggleVideoAuth(v)}>
                                    <i className={`bi me-1 ${v.ad_code_authorized ? 'bi-shield-check' : 'bi-shield-exclamation'}`} />
                                    {v.ad_code_authorized ? 'Authorized' : 'Not authorized'}
                                  </button>
                                </div>
                              )}
                              {v.notes && (
                                <div className="small mt-1 text-muted" style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>
                              )}
                            </div>
                            <button className="btn btn-sm btn-link p-0 text-danger flex-shrink-0"
                              title="Delete video"
                              disabled={deletingVideoId === v.id}
                              onClick={() => deleteVideo(v)}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </Tab>
            <Tab eventKey="overview" title={<><i className="bi bi-info-circle me-1" />Overview</>}>
              <Row className="g-3">
                <Col md={6}>
                  <div className="text-muted small">Brand</div>
                  <div className="fw-semibold">{brand?.name ?? '—'}</div>
                </Col>
                <Col md={6}>
                  <div className="text-muted small">Program</div>
                  <div className="fw-semibold">{program ? programDisplayName(program) : '—'}</div>
                </Col>
                <Col md={6}>
                  <div className="text-muted small">Status</div>
                  <Badge bg="" style={{ backgroundColor: meta.color }}>{meta.label}</Badge>
                </Col>
                <Col md={6}>
                  <div className="text-muted small">Agreed videos</div>
                  <div className="fw-semibold">{creatorLocal.agreed_videos || '—'}</div>
                </Col>
                <Col md={6}>
                  <div className="text-muted small">Fee</div>
                  <div className="fw-semibold">{fmtMoney(Number(creatorLocal.fee), program?.currency || 'USD')}</div>
                </Col>
                <Col md={6}>
                  <div className="text-muted small">Onboard date</div>
                  <div className="fw-semibold">
                    {creatorLocal.onboard_date ? new Date(creatorLocal.onboard_date + 'T00:00:00').toLocaleDateString() : '—'}
                  </div>
                </Col>
                {creatorLocal.paypal_email && (
                  <Col md={12}>
                    <div className="text-muted small">PayPal email</div>
                    <div className="fw-semibold"><i className="bi bi-paypal me-1 text-primary" />{creatorLocal.paypal_email}</div>
                  </Col>
                )}
                {creatorLocal.notes && (
                  <Col md={12}>
                    <div className="text-muted small">Notes</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{creatorLocal.notes}</div>
                  </Col>
                )}
              </Row>
            </Tab>
          </Tabs>
        </Modal.Body>
        <Modal.Footer className="d-flex flex-wrap gap-2 justify-content-between">
          <div className="d-flex gap-2 flex-wrap">
            <Button variant="outline-primary" size="sm" onClick={() => setPerfOpen(true)}
              title="Add or edit weekly / monthly performance">
              <i className="bi bi-graph-up-arrow me-1" />Performance
            </Button>
            {paymentPending && (
              <Button variant="success" size="sm"
                disabled={togglingPaid}
                onClick={togglePaidOut}
                title="Mark this creator as paid">
                <i className="bi bi-check-circle me-1" />
                {togglingPaid ? 'Saving…' : 'Mark paid'}
              </Button>
            )}
            {creatorLocal.paid_out && (
              <Button variant="outline-success" size="sm"
                disabled={togglingPaid}
                onClick={togglePaidOut}
                title="Mark as unpaid">
                <i className="bi bi-arrow-counterclockwise me-1" />
                {togglingPaid ? 'Saving…' : 'Undo paid'}
              </Button>
            )}
            <Button variant="outline-secondary" size="sm" onClick={() => setEditOpen(true)}>
              <i className="bi bi-pencil me-1" />Edit
            </Button>
            <Button variant="outline-danger" size="sm"
              disabled={deletingCreator}
              onClick={deleteCreator}
              title="Remove this creator from the program">
              <i className="bi bi-trash me-1" />
              {deletingCreator ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </Modal.Footer>
      </Modal>

      {/* Per-creator performance modal */}
      {perfOpen && (
        <PerformanceModal
          entityLabel={creatorLocal.name}
          perfTable="paid_creator_performance"
          fkColumn="creator_id"
          entityId={creatorLocal.id}
          siblingEntityIds={(() => {
            if (!brandCreators) return undefined;
            const key = creatorIdentityKey(creatorLocal);
            return brandCreators.filter(c => creatorIdentityKey(c) === key).map(c => c.id);
          })()}
          programLabelByEntityId={programLabelByCreatorId}
          anchorTable="paid_creators"
          anchorValue={creatorLocal.weekly_perf_anchor}
          currency={program?.currency || 'USD'}
          canEdit
          onClose={() => setPerfOpen(false)}
          onAnchorSet={(anchor) => {
            setCreatorLocal(prev => ({ ...prev, weekly_perf_anchor: anchor }));
            onCreatorUpdated?.({ ...creatorLocal, weekly_perf_anchor: anchor });
          }}
        />
      )}

      {/* Edit creator modal */}
      {editOpen && (
        <EditCreatorModal
          creator={creatorLocal}
          currency={program?.currency || 'USD'}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setCreatorLocal(updated);
            onCreatorUpdated?.(updated);
            setEditOpen(false);
          }}
        />
      )}

      {/* Step 1: pick manual vs bulk */}
      <Modal show={pickMode} onHide={() => setPickMode(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-collection-play me-2" />Add video</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-3">How would you like to add videos for <strong>{creatorLocal.name}</strong>?</p>
          <div className="d-grid gap-2">
            <Button variant="primary" size="lg" onClick={() => { setPickMode(false); setManualOpen(true); }}>
              <i className="bi bi-plus-lg me-2" />Add videos manually
              <div className="small fw-normal opacity-75">One-by-one with a quick form</div>
            </Button>
            <Button variant="outline-primary" size="lg" onClick={() => { setPickMode(false); setBulkOpen(true); }}>
              <i className="bi bi-upload me-2" />Add bulk videos
              <div className="small fw-normal text-muted">Paste a list of URLs (with or without ad codes)</div>
            </Button>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setPickMode(false)}>Cancel</Button>
        </Modal.Footer>
      </Modal>

      {/* Step 2: manual add — minimal form, brand/program/creator are implicit */}
      {manualOpen && (
        <ManualAddVideoModal
          creator={creatorLocal}
          program={program}
          brand={brand}
          products={products}
          onClose={() => setManualOpen(false)}
          onSaved={(v) => {
            setVideos(prev => [v, ...prev]);
            onVideoAdded(v);
            setManualOpen(false);
          }}
        />
      )}

      {/* Step 2 (alt): bulk add — paste URLs or URL+ad-code pairs */}
      {bulkOpen && (
        <BulkAddVideoModal
          creator={creatorLocal}
          program={program}
          brand={brand}
          products={products}
          onClose={() => setBulkOpen(false)}
          onSaved={(rows) => {
            setVideos(prev => [...rows, ...prev]);
            rows.forEach(r => onVideoAdded(r));
            setBulkOpen(false);
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// Manual Add Video — minimal form; brand/program/creator come from context
// =====================================================================
function ManualAddVideoModal({
  creator, program, brand, products, onClose, onSaved,
}: {
  creator: PaidCreator;
  program: PaidProgram | null;
  brand: Brand | null;
  products: BrandProduct[];
  onClose: () => void;
  onSaved: (v: PaidVideo) => void;
}) {
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({
    tiktok_url: '', posted_on: '', notes: '',
    ad_code: '', ad_code_authorized: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-pick the only product if there's just one
  useEffect(() => {
    if (products.length === 1) setProductId(products[0].id);
  }, [products]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId) { setErr('Pick which product this video was created for.'); return; }
    setBusy(true); setErr(null);
    try {
      const adCode = form.ad_code.trim() || null;
      const { data, error } = await supabase.from('paid_creator_videos').insert({
        creator_id: creator.id,
        product_id: productId,
        tiktok_url: form.tiktok_url.trim() || null,
        ad_code: adCode,
        // Authorization only means anything when an ad code is present.
        ad_code_authorized: adCode ? form.ad_code_authorized : false,
        status: 'live' as VideoStatus,
        posted_on: form.posted_on || todayISO(),
        notes: form.notes.trim() || null,
      }).select('*').single();
      if (error) throw error;
      onSaved(data as PaidVideo);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save video');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show onHide={onClose} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-plus-lg me-2" />Add video — {creator.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}

          {/* Context summary — brand & program are auto-selected from the creator. */}
          <div className="bg-light rounded p-2 mb-3 small d-flex flex-wrap gap-3">
            <span><span className="text-muted">Brand:</span> <strong>{brand?.name ?? '—'}</strong></span>
            <span><span className="text-muted">Program:</span> <strong>{program ? programDisplayName(program) : '—'}</strong></span>
            <span><span className="text-muted">Creator:</span> <strong>{creator.name}</strong></span>
          </div>

          <Form.Group className="mb-2">
            <Form.Label className="fw-bold">Product *</Form.Label>
            <Form.Select required value={productId}
              onChange={e => setProductId(e.target.value)}>
              <option value="">— Pick a product —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Form.Select>
            {products.length === 0 && (
              <Form.Text className="text-warning">
                No products attached to this program yet.
              </Form.Text>
            )}
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label className="fw-bold">TikTok URL</Form.Label>
            <Form.Control type="url" value={form.tiktok_url}
              placeholder="https://www.tiktok.com/@user/video/…"
              onChange={e => setForm({ ...form, tiktok_url: e.target.value })} />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label className="fw-bold">Ad code</Form.Label>
            <Form.Control value={form.ad_code}
              placeholder="Optional — TikTok ad code"
              onChange={e => setForm({ ...form, ad_code: e.target.value })} />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Check
              type="switch"
              id="manual-ad-auth"
              checked={form.ad_code_authorized}
              disabled={!form.ad_code.trim()}
              onChange={e => setForm({ ...form, ad_code_authorized: e.target.checked })}
              label={
                <span>
                  <i className={`bi me-1 ${form.ad_code_authorized ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-muted'}`} />
                  <strong>Ad code authorized</strong>
                  <span className="text-muted ms-2 small">
                    — toggle on once TikTok has approved this ad code.
                  </span>
                </span>
              }
            />
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label className="fw-bold">Posted on</Form.Label>
            <Form.Control type="date" value={form.posted_on}
              onChange={e => setForm({ ...form, posted_on: e.target.value })} />
            <Form.Text className="text-muted">Added videos count as live — defaults to today.</Form.Text>
          </Form.Group>

          <Form.Group className="mb-2">
            <Form.Label className="fw-bold">Notes</Form.Label>
            <Form.Control as="textarea" rows={2} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !productId}>
            {busy ? 'Saving…' : 'Add video'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// =====================================================================
// Edit Creator — same fields a handler can edit on the staff card.
// =====================================================================
function EditCreatorModal({
  creator, currency, onClose, onSaved,
}: {
  creator: PaidCreator;
  currency: string;
  onClose: () => void;
  onSaved: (c: PaidCreator) => void;
}) {
  const [form, setForm] = useState({
    name: creator.name,
    handle: creator.handle ?? '',
    fee: Number(creator.fee) || 0,
    agreed_videos: creator.agreed_videos,
    onboard_date: creator.onboard_date ?? todayISO(),
    status: creator.status,
    paypal_email: creator.paypal_email ?? '',
    notes: creator.notes ?? '',
    paid_out: !!creator.paid_out,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.from('paid_creators').update({
        name: form.name.trim(),
        handle: form.handle.trim() || null,
        fee: Number(form.fee) || 0,
        agreed_videos: Number(form.agreed_videos) || 0,
        onboard_date: form.onboard_date || null,
        status: form.status,
        paypal_email: form.paypal_email.trim() || null,
        notes: form.notes.trim() || null,
        paid_out: form.paid_out,
        paid_at: form.paid_out ? (creator.paid_at ?? new Date().toISOString()) : null,
      }).eq('id', creator.id).select('*').single();
      if (error) throw error;
      onSaved(data as PaidCreator);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save creator');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show onHide={onClose} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-pencil me-2" />Edit creator</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          <div className="row g-2">
            <Form.Group className="col-md-7 mb-2">
              <Form.Label className="fw-bold">Name</Form.Label>
              <Form.Control required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-md-5 mb-2">
              <Form.Label className="fw-bold">TikTok handle</Form.Label>
              <Form.Control value={form.handle} placeholder="@username"
                onChange={e => setForm({ ...form, handle: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="fw-bold">Fee ({currency})</Form.Label>
              <NumberInput min={0} step="any"
                value={form.fee}
                onChange={n => setForm({ ...form, fee: n })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="fw-bold">Agreed videos</Form.Label>
              <NumberInput min={0}
                value={form.agreed_videos}
                onChange={n => setForm({ ...form, agreed_videos: n })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="fw-bold">Status</Form.Label>
              <Form.Select value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as CreatorStatus })}>
                {CREATOR_STATUS_VALUES.map(s => (
                  <option key={s} value={s}>{CREATOR_STATUS_META[s].label}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6 mb-2">
              <Form.Label className="fw-bold">Onboard date</Form.Label>
              <Form.Control type="date" value={form.onboard_date}
                onChange={e => setForm({ ...form, onboard_date: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="fw-bold">
                <i className="bi bi-paypal me-1" />PayPal email
                <span className="text-muted ms-2 small">(optional)</span>
              </Form.Label>
              <Form.Control type="email" placeholder="creator@example.com"
                value={form.paypal_email}
                onChange={e => setForm({ ...form, paypal_email: e.target.value })} />
            </Form.Group>
          </div>

          <hr className="my-2" />
          <Form.Group className="mb-2">
            <Form.Check
              type="switch"
              id="edit-creator-paid"
              label={
                <span>
                  <i className="bi bi-cash-stack me-1" />
                  <strong>Marked as paid</strong>
                  <span className="text-muted ms-2 small">— turn on once you've paid the creator their fee.</span>
                </span>
              }
              checked={form.paid_out}
              onChange={e => setForm({ ...form, paid_out: e.target.checked })}
            />
          </Form.Group>

          <Form.Group className="mb-1">
            <Form.Label className="fw-bold">Notes</Form.Label>
            <Form.Control as="textarea" rows={3} value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !form.name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// =====================================================================
// Bulk Add Video — paste a list of URLs, or URL+ad-code pairs.
// =====================================================================
type BulkMode = 'urls' | 'urls_with_codes';

function parseUrlsOnly(text: string): { urls: string[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const urls: string[] = [];
  const errors: string[] = [];
  lines.forEach((l, i) => {
    if (!/^https?:\/\//i.test(l)) {
      errors.push(`Line ${i + 1}: "${l.length > 50 ? l.slice(0, 50) + '…' : l}" doesn't look like a URL`);
    } else {
      urls.push(l);
    }
  });
  if (urls.length === 0 && errors.length === 0) errors.push('Paste at least one URL.');
  return { urls, errors };
}

/**
 * Pair URLs with ad codes anywhere in the pasted text — order-based.
 *
 * Real-world data is messy: pairs may be on one line separated by tabs/spaces,
 * the ad code may wrap to the next line, and there may be extra trailing text
 * (e.g. " 0.0667 mins") after the code. We extract:
 *   - every URL (anything starting with http(s)://)
 *   - every ad code (substring starting with `#` and ending with one or more
 *     `=` characters — per the user's hint).
 * Then we pair them in order: the i-th code goes with the i-th URL, as long
 * as it appears AFTER the URL and BEFORE the next URL in the text.
 */
function parseUrlsWithAdCodes(text: string): { pairs: { url: string; ad_code: string }[]; errors: string[] } {
  if (!text.trim()) return { pairs: [], errors: ['Paste at least one URL + ad code pair.'] };

  // Find every URL with its position.
  const urlRe = /https?:\/\/\S+/g;
  const urls: { value: string; index: number }[] = [];
  for (let m: RegExpExecArray | null; (m = urlRe.exec(text)) !== null; ) {
    // Drop trailing punctuation that often gets glued.
    const v = m[0].replace(/[.,;)\]>]+$/, '');
    urls.push({ value: v, index: m.index });
  }

  // Find every ad code: starts with `#`, then non-whitespace/non-`#`/non-`=`
  // chars, ending with one or more `=` signs. Anything AFTER the trailing
  // `=` run is ignored — e.g. `#abc=glfja;'l` → `#abc=`, `#abc=0.0667 mins`
  // → `#abc=`, base64 padding `#abc==` is preserved as-is.
  const codeRe = /#[^\s#=]+=+/g;
  const codes: { value: string; index: number }[] = [];
  for (let m: RegExpExecArray | null; (m = codeRe.exec(text)) !== null; ) {
    codes.push({ value: m[0], index: m.index });
  }

  const errors: string[] = [];
  if (urls.length === 0) errors.push('No video URLs found.');
  if (codes.length === 0) errors.push('No ad codes found. Ad codes must start with `#` and end with `=`.');
  if (errors.length > 0) return { pairs: [], errors };

  // Pair each URL with the FIRST code that appears after it and before the
  // next URL — this handles tab-separated, wrapped, and mixed formats uniformly.
  const pairs: { url: string; ad_code: string }[] = [];
  const used = new Set<number>();
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    const nextIdx = i + 1 < urls.length ? urls[i + 1].index : Infinity;
    const code = codes.find(c =>
      !used.has(c.index) && c.index > u.index && c.index < nextIdx,
    );
    if (!code) {
      errors.push(`No ad code found after URL ${u.value.slice(0, 50)}${u.value.length > 50 ? '…' : ''}`);
      continue;
    }
    used.add(code.index);
    pairs.push({ url: u.value, ad_code: code.value });
  }
  // Unused codes (more codes than URLs).
  if (codes.length > urls.length) {
    errors.push(`Found ${codes.length} ad codes for only ${urls.length} URL${urls.length === 1 ? '' : 's'} — some codes were ignored.`);
  }
  return { pairs, errors };
}

function BulkAddVideoModal({
  creator, program, brand, products, onClose, onSaved,
}: {
  creator: PaidCreator;
  program: PaidProgram | null;
  brand: Brand | null;
  products: BrandProduct[];
  onClose: () => void;
  onSaved: (rows: PaidVideo[]) => void;
}) {
  const [mode, setMode] = useState<BulkMode>('urls');
  const [productId, setProductId] = useState('');
  const [text, setText] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-pick single product
  useEffect(() => {
    if (products.length === 1) setProductId(products[0].id);
  }, [products]);

  // Preview parse — recompute as user types / switches mode.
  const preview = useMemo(() => {
    if (!text.trim()) return { count: 0, errors: [] as string[] };
    if (mode === 'urls') {
      const { urls, errors } = parseUrlsOnly(text);
      return { count: urls.length, errors };
    }
    const { pairs, errors } = parseUrlsWithAdCodes(text);
    return { count: pairs.length, errors };
  }, [text, mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!productId) { setErr('Pick which product these videos were created for.'); return; }

    let rows: any[] = [];
    if (mode === 'urls') {
      const { urls, errors } = parseUrlsOnly(text);
      if (errors.length > 0) { setErr(errors.join('\n')); return; }
      rows = urls.map(u => ({
        creator_id: creator.id,
        product_id: productId,
        tiktok_url: u,
        status: 'live' as VideoStatus,
        posted_on: todayISO(),
      }));
    } else {
      const { pairs, errors } = parseUrlsWithAdCodes(text);
      if (errors.length > 0) { setErr(errors.join('\n')); return; }
      rows = pairs.map(p => ({
        creator_id: creator.id,
        product_id: productId,
        tiktok_url: p.url,
        ad_code: p.ad_code,
        ad_code_authorized: authorized,
        status: 'live' as VideoStatus,
        posted_on: todayISO(),
      }));
    }

    if (rows.length === 0) { setErr('Nothing to upload.'); return; }
    setBusy(true);
    const { data, error } = await supabase.from('paid_creator_videos').insert(rows).select('*');
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved((data ?? []) as PaidVideo[]);
  };

  const placeholderUrls =
    'https://www.tiktok.com/@user/video/123\n' +
    'https://www.tiktok.com/@user/video/456\n' +
    'https://www.tiktok.com/@user/video/789';

  const placeholderUrlsCodes =
    'https://www.tiktok.com/@user/video/123\n' +
    'AD-CODE-ABC123\n\n' +
    'https://www.tiktok.com/@user/video/456\n' +
    'AD-CODE-DEF456\n\n' +
    'https://www.tiktok.com/@user/video/789\n' +
    'AD-CODE-GHI789';

  return (
    <Modal show onHide={onClose} centered scrollable size="lg">
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-upload me-2" />Add bulk videos — {creator.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && (
            <Alert variant="danger" className="py-2" style={{ whiteSpace: 'pre-wrap' }}>{err}</Alert>
          )}

          {/* Context — brand + program are auto-selected from the clicked creator. */}
          <div className="bg-light rounded p-2 mb-3 small d-flex flex-wrap gap-3">
            <span><span className="text-muted">Brand:</span> <strong>{brand?.name ?? '—'}</strong></span>
            <span><span className="text-muted">Program:</span> <strong>{program ? programDisplayName(program) : '—'}</strong></span>
            <span><span className="text-muted">Creator:</span> <strong>{creator.name}</strong></span>
          </div>

          <Form.Group className="mb-3">
            <Form.Label className="fw-bold">Product *</Form.Label>
            <Form.Select required value={productId}
              onChange={e => setProductId(e.target.value)}>
              <option value="">— Pick a product —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Form.Select>
            {products.length === 0 && (
              <Form.Text className="text-warning">
                No products attached to this program yet.
              </Form.Text>
            )}
            {products.length === 1 && (
              <Form.Text className="text-muted">Auto-selected — only one product on this program.</Form.Text>
            )}
          </Form.Group>

          <Tabs activeKey={mode} onSelect={(k) => { setMode((k as BulkMode) ?? 'urls'); }} className="mb-3">
            <Tab eventKey="urls" title={<><i className="bi bi-link-45deg me-1" />Paste URLs</>}>
              <Form.Group className="mb-2">
                <Form.Label className="fw-bold">Video URLs</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={10}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={placeholderUrls}
                  style={{ fontFamily: 'monospace', fontSize: '.9rem' }}
                />
                <Form.Text className="text-muted">
                  One URL per line. Blank lines are ignored.
                </Form.Text>
              </Form.Group>
            </Tab>
            <Tab eventKey="urls_with_codes" title={<><i className="bi bi-upc-scan me-1" />Paste URLs with Ad Codes</>}>
              <Form.Group className="mb-2">
                <Form.Label className="fw-bold">URL + ad-code pairs</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={12}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={placeholderUrlsCodes}
                  style={{ fontFamily: 'monospace', fontSize: '.9rem' }}
                />
                <Form.Text className="text-muted">
                  Paste URLs and ad codes in any layout — tab-separated, line-separated, or mixed.
                  Codes must start with <code>#</code> and end with <code>=</code>; anything after the trailing <code>=</code> (e.g. <code>0.0667 mins</code>) is ignored.
                </Form.Text>
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Check
                  type="switch"
                  id="bulk-ad-auth"
                  checked={authorized}
                  onChange={e => setAuthorized(e.target.checked)}
                  label={
                    <span>
                      <i className={`bi me-1 ${authorized ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-muted'}`} />
                      <strong>Ad codes are authorized</strong>
                      <span className="text-muted ms-2 small">
                        — applies to every video in this batch. You can flip individual ones later.
                      </span>
                    </span>
                  }
                />
              </Form.Group>
            </Tab>
          </Tabs>

          {/* Live preview / validation summary */}
          {text.trim() && (
            preview.errors.length === 0 ? (
              <Alert variant="success" className="py-2 mb-0">
                <i className="bi bi-check2-circle me-1" />
                Ready to upload <strong>{preview.count}</strong> video{preview.count === 1 ? '' : 's'}
                {mode === 'urls_with_codes' && ` — ad codes ${authorized ? 'marked authorized' : 'not authorized'}`}.
              </Alert>
            ) : (
              <Alert variant="warning" className="py-2 mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                <i className="bi bi-exclamation-triangle me-1" />
                <strong>Found {preview.errors.length} issue{preview.errors.length === 1 ? '' : 's'}:</strong>
                {'\n'}{preview.errors.join('\n')}
              </Alert>
            )
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit"
            disabled={busy || !productId || preview.count === 0 || preview.errors.length > 0}>
            {busy
              ? 'Uploading…'
              : preview.count > 0
                ? `Upload ${preview.count} video${preview.count === 1 ? '' : 's'}`
                : 'Upload'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
