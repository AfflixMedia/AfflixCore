import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell,
} from 'recharts';
import type { HandlerCreator } from '../handler-collab/store';
import { copyWithToast, payoutKind } from '../../lib/copyToast';
import { currencySymbol, setReportCurrency } from '../../lib/currency';
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
  follow_up: { label: 'Follow-up Required', cls: 'followup' },
  pending: { label: 'Payment Pending', cls: 'pending' },
  paid: { label: 'Payment Sent', cls: 'sent' },
} as Record<string, { label: string; cls: string }>;

// Status as shown outside the handler workspace. All read views mask a
// "Payment Pending" the handler hasn't shared yet (per-creator toggle) back to
// "Videos in Progress". Additionally, the internal "Follow-up Required" nudge is
// staff-only: client-facing views (client portal + share link, staff=false) only
// ever see three states — Videos in Progress / Payment Pending / Payment Sent —
// while staff views (Bob/APC brand tab) keep it.
export const clientStatus = (c: HandlerCreator, staff = false) => {
  let s = c.payment_status;
  if (s === 'pending' && !c.pending_visible_to_client) s = 'videos_in_progress';
  if (!staff && s === 'follow_up') s = 'videos_in_progress';
  return s;
};
// True when this creator's payment-pending status is visible to the client.
export const isPendingVisible = (c: HandlerCreator) => clientStatus(c) === 'pending';

/* ── signed contract ──
   The creator signs through the handler's share link; every brand-access read
   view (client portal, share link, Bob/APC/Team Lead/Ads Manager brand tab)
   links to that signed copy at /sign/<token>, which serves the executed PDF
   read-only. Rows carry the signature as `signed_contract`, merged in at each
   fetch site. `contract_url` is the legacy manually-pasted link, kept as a
   fallback for deals signed before the e-signing flow. */
export type SignedContract = { token: string; signed_at?: string | null; signer_name?: string | null };
export const signedContractUrl = (c: any): string => {
  const t = c?.signed_contract?.token;
  if (t && c.signed_contract.signed_at) return `${window.location.origin}/sign/${t}`;
  return c?.contract_url || '';
};
export const signedContractTitle = (c: any): string => {
  const s = c?.signed_contract;
  if (s?.signed_at) {
    const who = s.signer_name ? ` by ${s.signer_name}` : '';
    return `Signed${who} · ${new Date(s.signed_at).toLocaleDateString()}`;
  }
  return 'Open signed contract';
};

export const monthKey = (d?: string | null) => (d ? String(d).slice(0, 7) : '');
// Whole-number money in the brand's currency. `code` is optional: single-brand
// views call setReportCurrency(brand.currency) at render and just use fmt$(n);
// multi-brand rows pass the row's currency explicitly.
export const fmt$ = (n: number, code?: string | null) => `${currencySymbol(code)}${Math.round(n || 0).toLocaleString()}`;
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

export function CreatorRowRO({ c, idx, onToggleAuth, onConfirmPaid, staffView }: {
  c: HandlerCreator; idx: number;
  // When provided, the "Authorised" cell becomes a clickable checkbox (APC/Bob).
  onToggleAuth?: (videoIndex: number, auth: boolean) => void;
  // When provided (client share view) and the creator is payment-pending, the
  // expanded panel shows a "process payment & mark as paid" toggle for the client.
  onConfirmPaid?: (confirmed: boolean) => Promise<void> | void;
  // Staff surfaces (Bob/APC brand tab) keep the internal "Follow-up Required"
  // status; client/share views mask it (see clientStatus).
  staffView?: boolean;
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
  const st = STATUS[clientStatus(c, staffView)] || STATUS.videos_in_progress;
  const prodList = creatorProducts(c);
  const contractUrl = signedContractUrl(c);
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
        <div className="pc-cell pc-contract-cell" data-label="Contract">
          {contractUrl
            ? (
              <a className="pc-contract-btn pc-clink has" href={contractUrl} target="_blank" rel="noopener noreferrer"
                title={signedContractTitle(c)} aria-label="Open signed contract" onClick={e => e.stopPropagation()}>
                <i className="bi bi-file-earmark-check" />
              </a>
            )
            : <span className="pc-handle">—</span>}
        </div>
        <div className="pc-cell pc-num" data-label="Content"><span className="pc-content-cell">{filled > 0 ? <b>{filled}</b> : ''} {open ? '▴' : '▾'}</span></div>

        {/* ── purpose-built mobile card (≤900px the cells above are hidden) ── */}
        <div className="pc-mc">
          <div className="pc-mc-head">
            <div className="pc-mc-idblock">
              <div className="pc-mc-name">{c.name}</div>
              <div className="pc-mc-subline">
                {accounts[0]
                  ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                  : <span className="pc-mc-muted">no TikTok</span>}
                {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
                {c.completed_on && <><span className="pc-mc-dot">·</span><span className="pc-mc-muted">{fmtDate(c.completed_on)}</span></>}
              </div>
            </div>
            <span className={`pc-mc-chev ${open ? 'open' : ''}`} aria-hidden>▾</span>
          </div>
          <div className="pc-mc-stats pc-mc-stats-3">
            <div className="pc-mc-stat"><b>{fmt$(Number(c.amount) || 0)}</b><span>Deal</span></div>
            <div className="pc-mc-stat"><b>{c.videos_count || '—'}</b><span>Videos</span></div>
            <div className="pc-mc-stat"><b className={filled ? 'pc-green' : ''}>{filled}/{total || 0}</b><span>Delivered</span></div>
          </div>
          <div className="pc-mc-foot">
            <span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span>
            {contractUrl && (
              <a className="pc-contract-btn pc-clink has" href={contractUrl} target="_blank" rel="noopener noreferrer"
                title={signedContractTitle(c)} aria-label="Open signed contract" onClick={e => e.stopPropagation()}>
                <i className="bi bi-file-earmark-check" />
              </a>
            )}
            {(c.paypal || c.zelle) && <span className="pc-mc-footmeta"><PayoutRO paypal={c.paypal} zelle={c.zelle} /></span>}
          </div>
        </div>
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
                {contractUrl && (
                  <a className="pc-vx-contractlink" href={contractUrl} target="_blank" rel="noopener noreferrer"
                    title={signedContractTitle(c)} onClick={e => e.stopPropagation()}>
                    <i className="bi bi-file-earmark-check" />
                    {(c as any).signed_contract?.signer_name
                      ? `Signed by ${(c as any).signed_contract.signer_name}`
                      : 'Signed contract'}
                  </a>
                )}
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
      <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div>Contract</div><div className="pc-num">Content</div>
    </div>
  );
}

const STATUS_GROUP_ORDER = ['pending', 'follow_up', 'videos_in_progress', 'paid'];
const statusGroupKey = (c: HandlerCreator, staff?: boolean) => { const s = clientStatus(c, staff); return STATUS[s] ? s : 'videos_in_progress'; };

// Read-only creator list grouped by payment status (Payment Pending → Videos in
// Progress → Payment Sent), each introduced by a labelled divider — mirrors the
// handler Workspace drilldown. `creators` should be pre-sorted; order is preserved
// within each group and the # index runs continuously top-to-bottom.
export function CreatorStatusGroupsRO({ creators, onToggleAuth, onConfirmPaid, staffView }: {
  creators: HandlerCreator[];
  onToggleAuth?: (creatorId: string, videoIndex: number, auth: boolean) => void;
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
  staffView?: boolean;
}) {
  let n = 0;
  const groups = STATUS_GROUP_ORDER
    .map(val => ({ val, st: STATUS[val], items: creators.filter(c => statusGroupKey(c, staffView) === val) }))
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
          {g.items.map(c => { n += 1; return <CreatorRowRO key={c.id} c={c} idx={n} staffView={staffView} onToggleAuth={onToggleAuth ? (i, a) => onToggleAuth(c.id, i, a) : undefined} onConfirmPaid={onConfirmPaid ? (v) => onConfirmPaid(c.id, v) : undefined} />; })}
        </Fragment>
      ))}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Performance report — client-facing reporting dashboard (read-only).
   Mirrors the handler's Internal Reporting: Monthly/Weekly lens, week selector,
   KPI tiles, GMV vs Ad area chart, payment mix, top creators + insights.
   Shared by the public share link's "Performance" tab and the client portal
   dashboard — both pass a brand + that brand's creators (current handler-collab model).
════════════════════════════════════════════════════════════ */
export interface PerfBrand { id: string; name: string; client: string | null; currency?: string | null }

const PR_STATUS: Record<string, { label: string; cls: string; color: string }> = {
  videos_in_progress: { label: 'In progress', cls: 'prog', color: '#1259C3' },
  pending:            { label: 'Pending',     cls: 'pend', color: '#E8862E' },
  paid:               { label: 'Paid',        cls: 'paid', color: '#198754' },
};
export const prAddDays = (k: string, n: number) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const prRangeShort = (s: string, e: string) => { const a = new Date(s + 'T00:00:00'), b = new Date(e + 'T00:00:00'); const am = a.toLocaleDateString('en-US', { month: 'short' }), bm = b.toLocaleDateString('en-US', { month: 'short' }); return am === bm ? `${am} ${a.getDate()}–${b.getDate()}` : `${am} ${a.getDate()} – ${bm} ${b.getDate()}`; };
const prRangeLong = (s: string, e: string) => { const f = (k: string) => new Date(k + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return `${f(s)} – ${f(e)}`; };
const prMonthShort = (k: string) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

export function PerformanceReport({ brand, creators, onDiscuss }: {
  brand: PerfBrand; creators: HandlerCreator[];
  onDiscuss?: (tt: string, tk: string) => void;
}) {
  const [mode, setMode] = useState<'monthly' | 'weekly'>('weekly');
  const [weekSel, setWeekSel] = useState<string | null>(null);
  const isWeekly = mode === 'weekly';
  // Money in this brand's currency ($/£/€). Set during render so fmt$ below uses it.
  setReportCurrency(brand.currency);

  const weekKeys = useMemo(() => {
    const s = new Set<string>();
    creators.forEach(c => { const w = (c.monthly as any)?.weeks || {}; Object.keys(w).forEach(k => s.add(k)); });
    return [...s].sort();
  }, [creators]);
  const activeWeek = isWeekly && weekSel && weekKeys.includes(weekSel) ? weekSel : null;

  const pGmv = (c: HandlerCreator) => {
    const mm: any = c.monthly || {};
    if (isWeekly) { const w = mm.weeks || {}; if (activeWeek) return Number(w[activeWeek]?.gmv) || 0; return Object.keys(w).reduce((t, k) => t + (Number(w[k]?.gmv) || 0), 0); }
    return gmvSum(c);
  };
  const pAd = (c: HandlerCreator) => {
    const mm: any = c.monthly || {};
    if (isWeekly) { const w = mm.weeks || {}; if (activeWeek) return Number(w[activeWeek]?.adSpent) || 0; return Object.keys(w).reduce((t, k) => t + (Number(w[k]?.adSpent) || 0), 0); }
    let t = 0; Object.keys(mm).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) t += Number(mm[k]?.adSpent) || 0; }); return t;
  };

  const kpis = useMemo(() => {
    let gmv = 0, ad = 0, del = 0, ag = 0, active = 0, pending = 0;
    creators.forEach(c => {
      gmv += pGmv(c); ad += pAd(c); del += deliveredCount(c); ag += Number(c.videos_count) || 0;
      if (c.payment_status !== 'paid') active += 1;
      if (isPendingVisible(c)) pending += 1;
    });
    const pipeline = creators.reduce((t, c) => t + Math.max(0, (Number(c.videos_count) || 0) - deliveredCount(c)), 0);
    return { gmv, ad, roas: ad > 0 ? gmv / ad : 0, del, ag, active, pipeline, pending, count: creators.length };
  }, [creators, isWeekly, activeWeek]);

  const trend = useMemo(() => {
    if (isWeekly) {
      return weekKeys.map(k => {
        let gmv = 0, ad = 0;
        creators.forEach(c => { const cell = (c.monthly as any)?.weeks?.[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
        return { label: prRangeShort(k, prAddDays(k, 6)), gmv, ad };
      });
    }
    const ms = new Set<string>();
    creators.forEach(c => { const mm: any = c.monthly || {}; Object.keys(mm).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) ms.add(k); }); });
    return [...ms].sort().map(k => {
      let gmv = 0, ad = 0;
      creators.forEach(c => { const cell = (c.monthly as any)?.[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
      return { label: prMonthShort(k), gmv, ad };
    });
  }, [creators, isWeekly, weekKeys]);

  const payMix = useMemo(() => {
    const m: any = { videos_in_progress: 0, pending: 0, paid: 0 };
    creators.forEach(c => { const s = clientStatus(c); m[s] = (m[s] || 0) + 1; });
    return Object.keys(PR_STATUS).map(k => ({ name: PR_STATUS[k].label, value: m[k] || 0, color: PR_STATUS[k].color })).filter(x => x.value > 0);
  }, [creators]);

  const rows = useMemo(() =>
    creators.map(c => ({ c, del: deliveredCount(c), ag: Number(c.videos_count) || 0, gmv: pGmv(c) }))
      .sort((a, b) => b.gmv - a.gmv || b.del - a.del).slice(0, 10),
  [creators, isWeekly, activeWeek]);

  const insights = useMemo(() => {
    const list: any[] = [];
    const top = [...creators].map(c => ({ c, gmv: pGmv(c) })).sort((a, b) => b.gmv - a.gmv)[0];
    if (top && top.gmv > 0) list.push({ tone: 'good', icon: 'bi-trophy-fill', text: <><b>{top.c.name}</b> leads with <b>{fmt$(top.gmv)}</b> GMV.</> });
    if (kpis.ad > 0) list.push({ tone: kpis.roas >= 1 ? 'good' : 'warn', icon: 'bi-graph-up-arrow', text: <>ROAS <b>{kpis.roas.toFixed(2)}x</b> on {fmt$(kpis.ad)} ad spend.</> });
    if (kpis.pipeline > 0) list.push({ tone: 'info', icon: 'bi-hourglass-split', text: <><b>{kpis.pipeline}</b> video{kpis.pipeline === 1 ? '' : 's'} in pipeline across <b>{kpis.active}</b> active creator{kpis.active === 1 ? '' : 's'}.</> });
    if (!isWeekly) { const cur = trend[trend.length - 1]?.gmv || 0, prev = trend[trend.length - 2]?.gmv || 0; if (prev > 0) { const pct = Math.round(((cur - prev) / prev) * 100); list.push({ tone: pct >= 0 ? 'good' : 'warn', icon: pct >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right', text: <>GMV {pct >= 0 ? 'up' : 'down'} <b>{Math.abs(pct)}%</b> vs the previous month.</> }); } }
    if (kpis.pending > 0) list.push({ tone: 'warn', icon: 'bi-cash-stack', text: <><b>{kpis.pending}</b> payment{kpis.pending === 1 ? '' : 's'} pending.</> });
    return list.slice(0, 5);
  }, [creators, kpis, trend, isWeekly, activeWeek]);

  const fewPoints = trend.filter(t => (t.gmv || 0) || (t.ad || 0)).length <= 1;
  const lblMoney = (v: any) => (Number(v) > 0 ? fmt$(v) : '');
  const moneyTip = (v: any) => fmt$(Number(v) || 0);

  return (
    <div className="pc-rd">
      <div className="pc-rd-top">
        <div>
          <h2 className="pc-rd-title">Performance report</h2>
          <div className="pc-rd-sub">
            {isWeekly
              ? <>Weekly · {activeWeek ? <b>{prRangeShort(activeWeek, prAddDays(activeWeek, 6))}</b> : 'all weeks'} · {brand.name}</>
              : <>Monthly · {brand.name}</>}
          </div>
        </div>
        <div className="pc-rd-actions">
          <div className="pc-seg" role="tablist" aria-label="Performance period">
            <button type="button" className={`pc-seg-btn ${!isWeekly ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly</button>
            <button type="button" className={`pc-seg-btn ${isWeekly ? 'active' : ''}`} onClick={() => setMode('weekly')}>Weekly</button>
          </div>
        </div>
      </div>

      {isWeekly && (
        <PillRow label={<><i className="bi bi-calendar3" /> Week</>}>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          {weekKeys.length === 0 ? (
            <span className="pc-rd-weeks-none">No weekly data yet</span>
          ) : weekKeys.map((k, i) => (
            <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)} title={prRangeLong(k, prAddDays(k, 6))}>
              <span className="pc-rd-week-n">W{i + 1}</span>{prRangeShort(k, prAddDays(k, 6))}
            </button>
          ))}
        </PillRow>
      )}

      <div className="pc-rd-kpis">
        <RShareKpi icon="bi-people-fill" color="#6610F2" label="Active creators" value={String(kpis.active)} sub={`${kpis.count} total`} />
        <RShareKpi icon="bi-collection-play-fill" color="#198754" label="Videos posted" value={String(kpis.del)} sub="delivered" />
        <RShareKpi icon="bi-hourglass-split" color="#0DCAF0" label="In pipeline" value={String(kpis.pipeline)} sub="to deliver" />
        <RShareKpi icon="bi-graph-up-arrow" color="#1259C3" label="GMV generated" value={fmt$(kpis.gmv)} sub={kpis.ad > 0 ? `${kpis.roas.toFixed(2)}x ROAS` : (isWeekly ? (activeWeek ? prRangeShort(activeWeek, prAddDays(activeWeek, 6)) : 'all weeks') : 'all months')} />
        <RShareKpi icon="bi-cash-coin" color="#E8862E" label="Ad spend" value={fmt$(kpis.ad)} sub="for this period" />
      </div>

      <div className="pc-rd-charts">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">GMV vs Ad spend</span><span className="pc-rd-card-s">{isWeekly ? 'by week' : 'by month'}</span></div>
          {trend.some(t => t.gmv || t.ad) ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="shGmv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1259C3" stopOpacity={0.45} /><stop offset="100%" stopColor="#1259C3" stopOpacity={0} /></linearGradient>
                    <linearGradient id="shAd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8862E" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8862E" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                  <Tooltip formatter={moneyTip} contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                  <Area type="monotone" dataKey="gmv" name="GMV" stroke="#1259C3" strokeWidth={2.5} fill="url(#shGmv)" dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#1259C3' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="gmv" position="top" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#1259C3' }} />}
                  </Area>
                  <Area type="monotone" dataKey="ad" name="Ad spend" stroke="#E8862E" strokeWidth={2.5} fill="url(#shAd)" dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#E8862E' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="ad" position="bottom" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#E8862E' }} />}
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No GMV logged for this period yet.</div>}
          <div className="pc-rd-legend"><span className="pc-rd-leg"><i style={{ background: '#1259C3' }} />GMV</span><span className="pc-rd-leg"><i style={{ background: '#E8862E' }} />Ad spend</span></div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Creator payment mix</span></div>
          {payMix.length ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={payMix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                    {payMix.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No creators yet.</div>}
          <div className="pc-rd-legend">{payMix.map((s, i) => <span className="pc-rd-leg" key={i}><i style={{ background: s.color }} />{s.name} · {s.value}</span>)}</div>
        </div>
      </div>

      <div className="pc-rd-lower">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Creators &amp; videos</span><span className="pc-rd-card-s">top {rows.length} by GMV</span></div>
          <div className="pc-rd-clist">
            <div className="pc-rd-crow pc-rd-crh"><span>Creator</span><span>Videos</span><span className="pc-rd-r">GMV</span><span className="pc-rd-r">Status</span></div>
            {rows.map(({ c, del, ag, gmv }) => {
              const pct = ag > 0 ? Math.min(100, Math.round((del / ag) * 100)) : (del > 0 ? 100 : 0);
              const st = PR_STATUS[clientStatus(c)] || PR_STATUS.videos_in_progress;
              return (
                <div className="pc-rd-crow" key={c.id}>
                  <span className="pc-rd-cname">
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ minWidth: 0 }}><span className="pc-rd-cn">{c.name}</span></span>
                  </span>
                  <span className="pc-rd-vid">
                    <span className="pc-rd-vid-top">{del}<i>/{ag || del || 0}</i></span>
                    <span className="pc-rd-track"><span className="pc-rd-fill" style={{ width: pct + '%', background: st.color }} /></span>
                  </span>
                  <span className="pc-rd-r pc-rd-gmv">{gmv > 0 ? fmt$(gmv) : '—'}</span>
                  <span className="pc-rd-r"><span className={`pc-rd-pill ${st.cls}`}>{st.label}</span></span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">Insights</span>
            {onDiscuss && <button className="pcc-reply" onClick={() => onDiscuss('insights', '')}><i className="bi bi-chat-left-text" />Discuss</button>}
          </div>
          {insights.length ? (
            <div className="pc-rd-ins">
              {insights.map((ins, i) => (
                <div className={`pc-rd-in ${ins.tone}`} key={i}><span className="pc-rd-in-ic"><i className={`bi ${ins.icon}`} /></span><span className="pc-rd-in-txt">{ins.text}</span></div>
              ))}
            </div>
          ) : <div className="pc-rd-chart-empty">No insights yet.</div>}
        </div>
      </div>
    </div>
  );
}

function RShareKpi({ icon, color, label, value, sub }: { icon: string; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className="pc-rk" style={{ ['--rk' as any]: color }}>
      <span className="pc-rk-ic" style={{ background: `${color}1a`, color }}><i className={`bi ${icon}`} /></span>
      <div className="pc-rk-body">
        <div className="pc-rk-label">{label}</div>
        <div className="pc-rk-value">{value}</div>
        {sub && <div className="pc-rk-sub">{sub}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Horizontal pill row with a pinned label and left/right nav arrows.
   The native scrollbar is hidden (it looked bad); the arrows appear only when
   the pills overflow and disable at each end. Used for the week selector and
   the client dashboard / Programs brand switcher.
════════════════════════════════════════════════════════════ */
export function PillRow({ label, className, children }: { label?: ReactNode; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const update = () => {
    const el = ref.current; if (!el) return;
    setOver(el.scrollWidth > el.clientWidth + 1);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  };
  useEffect(() => {
    update();
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(update); ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  });
  const by = (d: number) => ref.current?.scrollBy({ left: d, behavior: 'smooth' });
  return (
    <div className={`pc-rd-weeks ${className || ''}`}>
      {label && <span className="pc-rd-weeks-l">{label}</span>}
      {over && <button type="button" className="pc-pill-arrow" disabled={atStart} onClick={() => by(-240)} aria-label="Scroll left">‹</button>}
      <div className="pc-rd-weeks-scroll" ref={ref} onScroll={update}>{children}</div>
      {over && <button type="button" className="pc-pill-arrow" disabled={atEnd} onClick={() => by(240)} aria-label="Scroll right">›</button>}
    </div>
  );
}
