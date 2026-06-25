import { Fragment, useState } from 'react';
import type { HandlerCreator } from '../handler-collab/store';
import { copyWithToast, payoutKind } from '../../lib/copyToast';
import '../handler-collab/handlerCollab.css';

/* ════════════════════════════════════════════════════════════
   Shared READ-ONLY pieces that reproduce the handler Workspace drilldown look
   (pc-* styling from handlerCollab.css). Used by the client/handler program view
   and Bob/APC's Brand Detail → Paid Collab tab. View-only — no editing.
════════════════════════════════════════════════════════════ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];
export const STATUS = {
  videos_in_progress: { label: 'Videos in Progress', cls: 'progress' },
  pending: { label: 'Payment Pending', cls: 'pending' },
  paid: { label: 'Payment Sent', cls: 'sent' },
} as Record<string, { label: string; cls: string }>;

// Client-facing status: the handler keeps "Payment Pending" hidden until they flip
// the per-creator toggle on, so all read views (share link, client portal, Bob's
// brand tab) mask a not-yet-shared pending status back to "Videos in Progress".
export const clientStatus = (c: HandlerCreator) =>
  (c.payment_status === 'pending' && !c.pending_visible_to_client) ? 'videos_in_progress' : c.payment_status;
// True when this creator's payment-pending status is visible to the client.
export const isPendingVisible = (c: HandlerCreator) => clientStatus(c) === 'pending';

export const monthKey = (d?: string | null) => (d ? String(d).slice(0, 7) : '');
export const fmt$ = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
export const getGradient = (name: string) => (name ? AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length] : AVATAR_GRADIENTS[0]);
export const initial = (name: string) => { const s = (name || '').trim(); return s ? s[0].toUpperCase() : '?'; };
export const isValidUrl = (s?: string) => !!s && (s.startsWith('http://') || s.startsWith('https://'));
// PayPal payout value → openable link (URL / www. / paypal.me). Plain emails stay text.
function paypalUrl(raw?: string | null) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}
function copyText(t: string) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { /* ignore */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { /* ignore */ }
}
export function monthLabel(key: string) { if (!key) return '—'; const [y, m] = key.split('-'); return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`; }
export function fmtDate(d?: string | null) { if (!d) return '—'; const x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); }
function tiktokHandle(raw: string) {
  if (!raw) return '';
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) { const last = t.split('/').pop() || ''; return last.startsWith('@') ? last : `@${last}`; }
  return t.startsWith('@') ? t : `@${t}`;
}
export function tiktokAccounts(raw: string) {
  if (!raw) return [] as { handle: string; url: string }[];
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(h => ({
    handle: tiktokHandle(h),
    url: h.startsWith('http') ? h : `https://www.tiktok.com/${tiktokHandle(h)}`,
  }));
}
export function focusProductList(raw: string) {
  if (!raw) return [] as { name: string; url: string }[];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.map((x: any) => (typeof x === 'string' ? { name: '', url: x } : { name: x.name || '', url: x.url || '' })).filter(x => x.url || x.name); } catch { /* legacy */ }
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean).map(url => ({ name: '', url }));
}
export function creatorProducts(c: HandlerCreator) {
  const raw: any = c?.products;
  if (!Array.isArray(raw)) return [] as { name: string; url: string }[];
  return raw.map((p: any) => (typeof p === 'string' ? { name: p, url: '' } : { name: p.name || '', url: p.url || '' })).filter((p: any) => p.name || p.url);
}
export const deliveredCount = (c: HandlerCreator) => (Array.isArray(c.video_codes) ? c.video_codes.filter(v => v && v.video && String(v.video).trim()).length : 0);
export function gmvSum(c: HandlerCreator) { const m = c.monthly || {}; let t = 0; Object.keys(m).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) t += Number((m as any)[k]?.gmv) || 0; }); return t; }

export function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="pc-kpi">
      <div className="pc-kpi-label"><span className="pc-kpi-dot" style={{ background: color }} />{label}</div>
      <div className="pc-kpi-value">{value}</div>
      <div className="pc-kpi-sub">{sub}</div>
    </div>
  );
}

const CopyIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
const OpenIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
);

// Compact payout chip for table rows: a tag + a copy button (+ an open ↗ when the
// value is a link). Never prints the raw email/link inline — clicking copy puts it
// on the clipboard and shows a toast. `value` hover-title still reveals the full value.
export function PayChip({ kind, value }: { kind: 'pp' | 'zl'; value: string }) {
  const url = kind === 'pp' ? paypalUrl(value) : null;
  const k = url ? 'Link' : payoutKind(value);
  return (
    <span className="pc-paychip" title={value}>
      <span className={`pc-paytag ${kind}`}>{kind === 'pp' ? 'PP' : 'Z'}</span>
      <button type="button" className="pc-paycopy" aria-label={`Copy ${k.toLowerCase()}`} title={`Copy ${k.toLowerCase()}`}
        onClick={e => { e.stopPropagation(); copyWithToast(url || value, k); }}>{CopyIcon}</button>
      {url && (
        <a className="pc-payopen" href={url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()} title="Open link" aria-label="Open link">{OpenIcon}</a>
      )}
    </span>
  );
}

// Full payout line for the expanded panel: label + value (clickable when it's a link)
// + a copy button.
export function PayoutDetail({ kind, value }: { kind: 'pp' | 'zl'; value: string }) {
  const url = kind === 'pp' ? paypalUrl(value) : null;
  const k = url ? 'Link' : payoutKind(value);
  return (
    <div className="pc-payoutline">
      <span className={`pc-paytag ${kind}`}>{kind === 'pp' ? 'PP' : 'Z'}</span>
      <span className="pc-payoutline-label">{kind === 'pp' ? 'PayPal' : 'Zelle'}</span>
      {url
        ? <a className="pc-payoutline-val pc-paylink" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{value}</a>
        : <span className="pc-payoutline-val">{value}</span>}
      <button type="button" className="pc-paycopy" aria-label={`Copy ${k.toLowerCase()}`} title={`Copy ${k.toLowerCase()}`}
        onClick={e => { e.stopPropagation(); copyWithToast(url || value, k); }}>{CopyIcon}</button>
    </div>
  );
}

// Payout cell — compact copy chips (PP / Z). No raw email/link printed in the row.
function PayoutRO({ paypal, zelle }: { paypal?: string | null; zelle?: string | null }) {
  if (!paypal && !zelle) return <span className="pc-handle">—</span>;
  return (
    <div className="pc-payout">
      {paypal && <PayChip kind="pp" value={paypal} />}
      {zelle && <PayChip kind="zl" value={zelle} />}
    </div>
  );
}

export function CreatorRowRO({ c, idx, onToggleAuth, onConfirmPaid }: {
  c: HandlerCreator; idx: number;
  // When provided, the "Authorised" cell becomes a clickable checkbox (APC/Bob).
  onToggleAuth?: (videoIndex: number, auth: boolean) => void;
  // When provided (client share view) and the creator is payment-pending, the
  // expanded panel shows a "process payment & mark as paid" toggle for the client.
  onConfirmPaid?: (confirmed: boolean) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [paidBusy, setPaidBusy] = useState(false);
  const clientConfirmed = !!c.client_paid_confirmed_at;
  const handleConfirmPaid = async (next: boolean) => {
    if (!onConfirmPaid || paidBusy) return;
    setPaidBusy(true);
    try { await onConfirmPaid(next); } finally { setPaidBusy(false); }
  };
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const copyCode = (i: number, code: string) => { copyText(code); setCopiedIdx(i); setTimeout(() => setCopiedIdx(x => (x === i ? -1 : x)), 1400); };
  const accounts = tiktokAccounts(c.tiktok_handle);
  const codes = Array.isArray(c.video_codes) ? c.video_codes : [];
  // Parent owns the optimistic state (so it can revert on failure); we just report the toggle.
  const toggleAuth = (i: number) => { if (onToggleAuth) onToggleAuth(i, !codes[i].auth); };
  const filled = codes.filter(v => isValidUrl(v.video)).length;
  const total = Math.max(codes.length, Number(c.videos_count) || 0);
  const pct = total ? filled / total : 0;
  const RING = 2 * Math.PI * 19;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  const st = STATUS[clientStatus(c)] || STATUS.videos_in_progress;
  const prodList = creatorProducts(c);
  const initials = (c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

  return (
    <>
      <div className={`pc-ct-row ${open ? 'open' : ''}`} onClick={() => setOpen(o => !o)} role="button" tabIndex={0}>
        <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
        <div className="pc-cell" data-label="Completed on">{c.completed_on ? fmtDate(c.completed_on) : <span className="pc-handle">—</span>}</div>
        <div className="pc-cell" data-label="Name"><span className="pc-cname">{c.name}</span></div>
        <div className="pc-cell" data-label="TikTok">
          {accounts.length > 0
            ? <span className="pc-tiktok"><a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>{accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}</span>
            : <span className="pc-handle">—</span>}
        </div>
        <div className="pc-cell pc-num" data-label="Amount"><span className="pc-money">{fmt$(Number(c.amount) || 0)}</span></div>
        <div className="pc-cell pc-num" data-label="Videos">{c.videos_count || '—'}</div>
        <div className="pc-cell" data-label="Payout"><PayoutRO paypal={c.paypal} zelle={c.zelle} /></div>
        <div className="pc-cell" data-label="Status"><span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span></div>
        <div className="pc-cell pc-num" data-label="Content"><span className="pc-content-cell">{filled > 0 ? <b>{filled}</b> : ''} {open ? '▴' : '▾'}</span></div>
      </div>
      {open && (
        <div className="pc-expand" onClick={e => e.stopPropagation()}>
          <div className="pc-vx">
            <div className="pc-vx-head">
              <div className="pc-vx-title">
                <span className="pc-vx-mono">{initials}</span>
                <div className="pc-vx-titletext">
                  <div className="pc-vx-h">Videos &amp; Ad Codes</div>
                  <div className="pc-vx-sub">{c.name}{accounts[0] ? <> · <span className="pc-vx-sub-h">{accounts[0].handle}</span></> : ''}</div>
                </div>
              </div>
              <div className="pc-vx-actions">
                {adCount > 0 && (
                  <span className={`pc-vx-authtally ${allAuth ? 'done' : ''}`}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    {authCount}/{adCount} authorised
                  </span>
                )}
                <div className={`pc-vx-ring ${total > 0 && filled === total ? 'full' : ''}`}>
                  <svg viewBox="0 0 46 46" width="48" height="48">
                    <circle className="pc-vx-ring-track" cx="23" cy="23" r="19" />
                    <circle className="pc-vx-ring-fill" cx="23" cy="23" r="19" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct)} transform="rotate(-90 23 23)" />
                  </svg>
                  <span className="pc-vx-ring-txt"><b>{filled}</b><i>/{total}</i></span>
                </div>
              </div>
            </div>
            {prodList.length > 0 && (
              <div className="pc-vx-prods">
                <span className="pc-vx-prods-l">Promoting</span>
                {prodList.map((p, i) => (p.url
                  ? <a key={i} className="pc-vx-prod" href={p.url} target="_blank" rel="noopener noreferrer"><span className="pc-vx-prod-dot" />{p.name || 'Product'}<span className="pc-vx-prod-go">↗</span></a>
                  : <span key={i} className="pc-vx-prod"><span className="pc-vx-prod-dot" />{p.name}</span>))}
              </div>
            )}
            {(c.paypal || c.zelle) && (
              <div className="pc-vx-payouts">
                {c.paypal && <PayoutDetail kind="pp" value={c.paypal} />}
                {c.zelle && <PayoutDetail kind="zl" value={c.zelle} />}
              </div>
            )}
            {/* Client "process payment & mark as done" panel — only on the client
                share view (onConfirmPaid set) while the deal is payment-pending. */}
            {onConfirmPaid && clientStatus(c) === 'pending' && (
              <div className={`pc-paynudge ${clientConfirmed ? 'done' : ''}`}>
                <div className="pc-paynudge-ic">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {clientConfirmed ? <path d="M20 6 9 17l-5-5" /> : <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>}
                  </svg>
                </div>
                <div className="pc-paynudge-body">
                  <div className="pc-paynudge-title">
                    {clientConfirmed ? 'Payment marked as done' : 'Action needed — process this payment'}
                  </div>
                  <div className="pc-paynudge-text">
                    {clientConfirmed
                      ? <>Thanks{c.client_paid_confirmed_name ? `, ${c.client_paid_confirmed_name}` : ''} — the team has been notified and will verify, then finalize the status.</>
                      : <>Please process the payment via PayPal{c.paypal ? <> (<b>{c.paypal}</b>)</> : ''}, then mark it as done below. The team will cross-check and finalize.</>}
                  </div>
                </div>
                <button type="button"
                  className={`pc-paynudge-btn ${clientConfirmed ? 'on' : ''}`}
                  aria-pressed={clientConfirmed}
                  disabled={paidBusy}
                  onClick={e => { e.stopPropagation(); handleConfirmPaid(!clientConfirmed); }}
                  title={clientConfirmed ? 'Undo — mark as not paid' : 'Mark this payment as done'}>
                  <span className="pc-paynudge-knob" />
                  <span className="pc-paynudge-btn-txt">{paidBusy ? 'Saving…' : clientConfirmed ? 'Marked as paid' : 'Mark as paid'}</span>
                </button>
              </div>
            )}
            {/* Read-only badge so handler / Bob / APC views can see the client's claim. */}
            {!onConfirmPaid && clientConfirmed && (
              <div className="pc-paynudge done compact">
                <div className="pc-paynudge-ic">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </div>
                <div className="pc-paynudge-body">
                  <div className="pc-paynudge-title">Client marked this payment as done</div>
                  <div className="pc-paynudge-text">
                    {c.client_paid_confirmed_name ? <><b>{c.client_paid_confirmed_name}</b> · </> : null}
                    Cross-check, then set the status to Payment Sent.
                  </div>
                </div>
              </div>
            )}
            <div className="pc-vx-collabels"><span /><span>Video</span><span>Ad code</span><span className="pc-vx-cl-auth">Authorised</span><span /></div>
            <div className="pc-vx-list">
              {codes.length === 0 ? (
                <div className="pc-handle" style={{ padding: '8px 4px' }}>No videos added yet.</div>
              ) : codes.map((row, i) => {
                const vOk = isValidUrl(row.video);
                return (
                  <div className={`pc-vx-row ${vOk ? 'done' : ''}`} key={i}>
                    <span className="pc-vx-num">{vOk
                      ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      : i + 1}</span>
                    <div className="pc-vx-inp" style={{ alignItems: 'center' }}>
                      <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                      {vOk
                        ? <a className="pc-handle pc-vx-val" href={row.video} target="_blank" rel="noopener noreferrer" title={row.video} onClick={e => e.stopPropagation()}>{row.video}</a>
                        : <span className="pc-handle pc-vx-val" title={row.video || ''}>{row.video || '—'}</span>}
                    </div>
                    <div className="pc-vx-inp pc-vx-inp-ad" style={{ alignItems: 'center' }}>
                      <span className="pc-vx-inp-ico">#</span>
                      <span className="pc-vx-val" title={row.adCode || ''}>{row.adCode || '—'}</span>
                      {row.adCode ? (
                        <button type="button" className={`pc-vx-copy ${copiedIdx === i ? 'ok' : ''}`} title="Copy ad code" onClick={e => { e.stopPropagation(); copyCode(i, row.adCode); }}>
                          {copiedIdx === i
                            ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                            : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                        </button>
                      ) : null}
                    </div>
                    {onToggleAuth ? (
                      <button type="button" role="checkbox" aria-checked={row.auth}
                        className={`pc-vx-auth pc-vx-auth-edit ${row.auth ? 'on' : ''}`}
                        title={row.auth ? 'Authorised — click to unmark' : 'Mark as authorised'}
                        onClick={e => { e.stopPropagation(); toggleAuth(i); }}>
                        {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                      </button>
                    ) : (
                      <span className={`pc-vx-auth ${row.auth ? 'on' : ''}`} aria-checked={row.auth}>
                        {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                      </span>
                    )}
                    <a className="pc-vx-open" href={vOk ? row.video : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!vOk}>
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CreatorListHeadRO() {
  return (
    <div className="pc-ct-head">
      <div className="pc-num">#</div><div>Completed on</div><div>Name</div><div>TikTok</div><div className="pc-num">Amount</div>
      <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div className="pc-num">Content</div>
    </div>
  );
}

const STATUS_GROUP_ORDER = ['pending', 'videos_in_progress', 'paid'];
const statusGroupKey = (c: HandlerCreator) => { const s = clientStatus(c); return STATUS[s] ? s : 'videos_in_progress'; };

// Read-only creator list grouped by payment status (Payment Pending → Videos in
// Progress → Payment Sent), each introduced by a labelled divider — mirrors the
// handler Workspace drilldown. `creators` should be pre-sorted; order is preserved
// within each group and the # index runs continuously top-to-bottom.
export function CreatorStatusGroupsRO({ creators, onToggleAuth, onConfirmPaid }: {
  creators: HandlerCreator[];
  onToggleAuth?: (creatorId: string, videoIndex: number, auth: boolean) => void;
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
}) {
  let n = 0;
  const groups = STATUS_GROUP_ORDER
    .map(val => ({ val, st: STATUS[val], items: creators.filter(c => statusGroupKey(c) === val) }))
    .filter(g => g.items.length > 0);
  return (
    <>
      {groups.map(g => (
        <Fragment key={g.val}>
          <div className={`pc-ct-group ${g.st.cls}`}>
            <span className="pc-ct-group-label">
              <span className={`pc-statusdot ${g.st.cls}`} />{g.st.label}
              <span className="pc-ct-group-count">{g.items.length}</span>
            </span>
          </div>
          {g.items.map(c => { n += 1; return <CreatorRowRO key={c.id} c={c} idx={n} onToggleAuth={onToggleAuth ? (i, a) => onToggleAuth(c.id, i, a) : undefined} onConfirmPaid={onConfirmPaid ? (v) => onConfirmPaid(c.id, v) : undefined} />; })}
        </Fragment>
      ))}
    </>
  );
}
