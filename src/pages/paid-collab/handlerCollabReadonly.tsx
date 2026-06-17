import { useState } from 'react';
import type { HandlerCreator } from '../handler-collab/store';
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

export const monthKey = (d?: string | null) => (d ? String(d).slice(0, 7) : '');
export const fmt$ = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
export const getGradient = (name: string) => (name ? AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length] : AVATAR_GRADIENTS[0]);
export const initial = (name: string) => { const s = (name || '').trim(); return s ? s[0].toUpperCase() : '?'; };
export const isValidUrl = (s?: string) => !!s && (s.startsWith('http://') || s.startsWith('https://'));
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

export function CreatorRowRO({ c, idx }: { c: HandlerCreator; idx: number }) {
  const [open, setOpen] = useState(false);
  const accounts = tiktokAccounts(c.tiktok_handle);
  const codes = Array.isArray(c.video_codes) ? c.video_codes : [];
  const filled = codes.filter(v => isValidUrl(v.video)).length;
  const total = Math.max(codes.length, Number(c.videos_count) || 0);
  const pct = total ? filled / total : 0;
  const RING = 2 * Math.PI * 19;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  const st = STATUS[c.payment_status] || STATUS.videos_in_progress;
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
        <div className="pc-cell" data-label="Payout">
          {(c.paypal || c.zelle)
            ? <div className="pc-payout">{c.paypal && <span className="pc-payline"><span className="pc-paytag pp">PP</span><span className="pc-payval">{c.paypal}</span></span>}{c.zelle && <span className="pc-payline"><span className="pc-paytag zl">Z</span><span className="pc-payval">{c.zelle}</span></span>}</div>
            : <span className="pc-handle">—</span>}
        </div>
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
                      {vOk ? <a className="pc-handle" href={row.video} target="_blank" rel="noopener noreferrer">{row.video}</a> : <span className="pc-handle">{row.video || '—'}</span>}
                    </div>
                    <div className="pc-vx-inp pc-vx-inp-ad" style={{ alignItems: 'center' }}>
                      <span className="pc-vx-inp-ico">#</span>
                      <span>{row.adCode || '—'}</span>
                    </div>
                    <span className={`pc-vx-auth ${row.auth ? 'on' : ''}`} aria-checked={row.auth}>
                      {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                    </span>
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
