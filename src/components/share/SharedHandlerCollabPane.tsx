import { useEffect, useMemo, useState } from 'react';
import PaidCollabDiscussionDrawer from '../paidcollab/PaidCollabDiscussionDrawer';
import type { PaidCollabComment } from '../../pages/handler-collab/store';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell,
} from 'recharts';
import type { HandlerBrandMonth, HandlerCreator } from '../../pages/handler-collab/store';
import {
  fmt$, getGradient, initial, monthKey, monthLabel, focusProductList,
  deliveredCount, gmvSum, isPendingVisible, clientStatus, Kpi, CreatorListHeadRO, CreatorStatusGroupsRO,
} from '../../pages/paid-collab/handlerCollabReadonly';

/* ════════════════════════════════════════════════════════════
   "New Paid Collab" tab on the public share view — read-only, current handler-collab
   model (one brand-month = one program). Programs list → click → program detail (workspace
   drilldown look), plus a Performance sub-tab with a GMV/Ad-spend/ROAS chart. Data is
   pre-fetched by get-shared-reports (public users have no RLS access).
════════════════════════════════════════════════════════════ */
interface BrandLite { id: string; name: string; client: string | null }

export default function SharedHandlerCollabPane({ brand, months, creators, comments = [], publicName, onAddComment, onConfirmPaid }: {
  brand: BrandLite; months: HandlerBrandMonth[]; creators: HandlerCreator[];
  comments?: PaidCollabComment[];
  publicName?: string;
  onAddComment?: (brandId: string, targetType: string, targetKey: string, body: string, authorName: string, parentId?: string) => Promise<void>;
  // Client confirms they processed a creator's payment — flags it + pings the team.
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void>;
}) {
  const [section, setSection] = useState<'programs' | 'performance' | 'discussions'>('programs');
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  // Right-side discussion drawer ({ tt, tk, highlight } | null).
  const [disc, setDisc] = useState<{ tt: string; tk: string; highlight?: string } | null>(null);
  const openDisc = (tt: string, tk: string, highlight?: string) => setDisc({ tt, tk, highlight });

  // Comments for this brand + the drawer's onAdd (posts via the public edge fn).
  const bComments = useMemo(() => comments.filter(c => c.brand_id === brand.id), [comments, brand.id]);
  const discAdd = async (tt: string, tk: string, body: string, authorName: string, parentId?: string) => {
    await onAddComment?.(brand.id, tt, tk, body, authorName, parentId);
  };

  // "New replies" since last visit — handler/staff comments the client hasn't seen.
  // Capture the seen timestamp once at mount so badges stay stable during the visit.
  const [seenAt] = useState(() => Number(localStorage.getItem(`ac_pcc_seen_${brand.id}`) || 0));
  const newReplies = useMemo(() =>
    bComments.filter(c => c.author_type !== 'client' && new Date(c.created_at).getTime() > seenAt).length,
  [bComments, seenAt]);
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(`ac_pcc_seen_${brand.id}`, String(Date.now())), 1500);
    return () => clearTimeout(t);
  }, [brand.id, bComments.length]);

  const bMonths = useMemo(
    () => months.filter(m => m.brand_id === brand.id).sort((a, b) => String(b.month).localeCompare(String(a.month))),
    [months, brand.id],
  );
  const bCreators = useMemo(() => creators.filter(c => c.brand_id === brand.id), [creators, brand.id]);

  // Per-program (month) rollup — creators onboarded that month + their stats.
  const programRows = useMemo(() => bMonths.map(m => {
    const mc = bCreators.filter(c => monthKey(c.onboarded_on) === m.month);
    let allocated = 0, videos = 0, delivered = 0, gmv = 0, pendingCount = 0;
    mc.forEach(c => { allocated += Number(c.amount) || 0; videos += Number(c.videos_count) || 0; delivered += deliveredCount(c); gmv += gmvSum(c); if (isPendingVisible(c)) pendingCount += 1; });
    return { m, creators: mc.length, budget: Number(m.budget) || 0, allocated, videos, delivered, gmv, pendingCount };
  }), [bMonths, bCreators]);

  if (bMonths.length === 0 && bCreators.length === 0) {
    return (
      <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👥</div>
          <h3>No paid collab data for {brand.name}</h3>
        </div></div>
      </div>
    );
  }

  // ── Program detail (one month) ──
  if (openMonth) {
    const m = bMonths.find(x => x.month === openMonth);
    const mc = bCreators.filter(c => monthKey(c.onboarded_on) === openMonth)
      .sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || '')));
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    mc.forEach(c => { allocated += Number(c.amount) || 0; if (c.payment_status === 'paid') paid += Number(c.amount) || 0; videos += Number(c.videos_count) || 0; delivered += deliveredCount(c); });
    const budget = Number(m?.budget) || 0;
    const usage = budget > 0 ? Math.round((allocated / budget) * 100) : 0;
    const cpv = delivered > 0 ? allocated / delivered : 0;
    const products = m ? focusProductList(m.focus_product_url) : [];
    return (
      <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
        <button className="pc-back" onClick={() => setOpenMonth(null)}>‹ All programs</button>
        <div className="pc-dd-head">
          <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="pc-dd-title">{brand.name}</h2>
            <div className="pc-dd-sub">{monthLabel(openMonth)}{brand.client ? ` · ${brand.client}` : ''}</div>
            <div className="pc-dd-links">
              {m?.content_guide_url && <a className="pc-link-chip set" href={m.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>}
              {products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer">{p.name || `Focus product ${i + 1}`} ↗</a>)}
            </div>
          </div>
          {onAddComment && (
            <div className="pc-dd-actions">
              <button className="pc-disc-btn" style={{ height: 34 }} onClick={() => openDisc('program', openMonth!)}>
                <i className="bi bi-chat-left-text" />Discussion
              </button>
            </div>
          )}
        </div>
        <div className="pc-kpis pc-kpis-5">
          <Kpi label="Budget" color="#1259C3" value={budget ? fmt$(budget) : '—'} sub={budget ? `${usage}% used` : 'not set'} />
          <Kpi label="Allocated" color="#8B5CF6" value={fmt$(allocated)} sub={`${mc.length} creator${mc.length === 1 ? '' : 's'}`} />
          <Kpi label="Paid" color="#2E7D32" value={fmt$(paid)} sub={`${allocated > 0 ? Math.round((paid / allocated) * 100) : 0}% paid out`} />
          <Kpi label="Videos" color="#0EA5E9" value={`${delivered}/${videos}`} sub={`${videos > 0 ? Math.round((delivered / videos) * 100) : 0}% completed`} />
          <Kpi label="Cost / Video" color="#E65100" value={cpv ? fmt$(cpv) : '—'} sub="per delivered video" />
        </div>
        {m?.notes && m.notes.trim() && <div className="pc-card" style={{ padding: 16, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{m.notes}</div>}
        {mc.length === 0 ? (
          <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">👤</div><h3>No creators in {monthLabel(openMonth)}</h3></div></div>
        ) : (
          <div className="pc-card pc-list">
            <CreatorListHeadRO />
            <CreatorStatusGroupsRO creators={mc} onConfirmPaid={onConfirmPaid} />
          </div>
        )}
        {disc && (
          <PaidCollabDiscussionDrawer brand={brand} comments={comments} creators={creators} months={months}
            mode="public" publicName={publicName} initial={disc} onAdd={discAdd} onClose={() => setDisc(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      {newReplies > 0 && (
        <div className="pc-card" style={{ padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, background: '#FFF6EC', borderColor: '#F0C28A' }}>
          <i className="bi bi-chat-dots-fill" style={{ color: '#E8862E' }} />
          <span style={{ fontWeight: 700, color: '#A85B12' }}>{newReplies} new repl{newReplies === 1 ? 'y' : 'ies'}</span>
          <span style={{ color: '#A85B12' }}>from the team since your last visit.</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="pc-tabs" style={{ margin: 0 }}>
          <button className={`pc-tab ${section === 'programs' ? 'active' : ''}`} onClick={() => setSection('programs')}>Programs</button>
          <button className={`pc-tab ${section === 'performance' ? 'active' : ''}`} onClick={() => setSection('performance')}>Performance</button>
          {onAddComment && (
            <button className={`pc-tab ${section === 'discussions' ? 'active' : ''}`} onClick={() => setSection('discussions')}>
              Discussions
              {newReplies > 0 && <span className="pc-tab-badge">{newReplies}</span>}
            </button>
          )}
        </div>
        {onAddComment && (
          <button className="pc-disc-btn" style={{ marginLeft: 'auto' }} onClick={() => openDisc('brand', '')} title="Open discussion">
            <i className="bi bi-chat-left-text" />Discussion
            {newReplies > 0 && <span className="pc-disc-badge">{newReplies}</span>}
            {newReplies === 0 && bComments.length > 0 && <span className="pcc-count">{bComments.length}</span>}
          </button>
        )}
      </div>

      {section === 'programs' ? (
        programRows.length === 0 ? (
          <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">🗂️</div><h3>No programs yet</h3></div></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {programRows.map(r => (
              <div key={r.m.id} className={`pc-card pc-prog-card ${r.pendingCount > 0 ? 'pc-prog-pending' : ''}`} role="button" tabIndex={0}
                style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
                onClick={() => setOpenMonth(r.m.month)}
                onKeyDown={e => { if (e.key === 'Enter') setOpenMonth(r.m.month); }}>
                <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {monthLabel(r.m.month)}
                    {r.pendingCount > 0 && (
                      <span className="pc-prog-pendpill">
                        <span className="pc-statusdot pending" />
                        Payment pending{r.pendingCount > 1 ? ` · ${r.pendingCount}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="pc-kpi-sub">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} videos</div>
                </div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{fmt$(r.budget)}</div><div className="pc-kpi-sub">budget</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{fmt$(r.allocated)}</div><div className="pc-kpi-sub">allocated</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }} className="pc-green">{r.gmv ? fmt$(r.gmv) : '—'}</div><div className="pc-kpi-sub">GMV</div></div>
                <span className="pc-chev">›</span>
              </div>
            ))}
          </div>
        )
      ) : section === 'discussions' ? (
        <ShareDiscussions brand={brand} comments={bComments} creators={bCreators} seenAt={seenAt} onOpen={openDisc} />
      ) : (
        <PerformanceReport brand={brand} creators={bCreators} onDiscuss={onAddComment ? openDisc : undefined} />
      )}

      {disc && (
        <PaidCollabDiscussionDrawer brand={brand} comments={comments} creators={creators} months={months}
          mode="public" publicName={publicName} initial={disc} onAdd={discAdd} onClose={() => setDisc(null)} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Client "all discussions" list — every thread for this brand, grouped/filtered
   by level. Click a thread to open its drawer (latest comment highlighted).
════════════════════════════════════════════════════════════ */
const SD_KPI_LABEL: Record<string, string> = {
  active_creators: 'Active creators', videos_posted: 'Videos posted', pipeline: 'In pipeline', gmv: 'GMV generated', ad: 'Ad spend',
};
const SD_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'brand', label: 'Brand' }, { id: 'program', label: 'Program' },
  { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
];
function sdShortDate(iso: string) {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function ShareDiscussions({ brand, comments, creators, seenAt, onOpen }: {
  brand: BrandLite; comments: PaidCollabComment[]; creators: HandlerCreator[]; seenAt: number;
  onOpen: (tt: string, tk: string, highlight?: string) => void;
}) {
  const [lvl, setLvl] = useState('all');
  const threads = useMemo(() => {
    const map = new Map<string, { tt: string; tk: string; items: PaidCollabComment[] }>();
    comments.forEach(c => {
      const k = `${c.target_type}|${c.target_key}`;
      let t = map.get(k);
      if (!t) { t = { tt: c.target_type, tk: c.target_key, items: [] }; map.set(k, t); }
      t.items.push(c);
    });
    return [...map.values()].map(t => {
      const sorted = t.items.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const last = sorted[sorted.length - 1];
      const newReply = last.author_type !== 'client' && new Date(last.created_at).getTime() > seenAt;
      return { ...t, count: t.items.length, last, newReply };
    }).sort((a, b) => (Number(b.newReply) - Number(a.newReply)) || String(b.last.created_at).localeCompare(String(a.last.created_at)));
  }, [comments, seenAt]);
  const counts = useMemo(() => { const c: any = { all: threads.length }; threads.forEach(t => { c[t.tt] = (c[t.tt] || 0) + 1; }); return c; }, [threads]);
  const shown = lvl === 'all' ? threads : threads.filter(t => t.tt === lvl);
  const tlabel = (t: { tt: string; tk: string }) => t.tt === 'brand' ? 'Whole brand' : t.tt === 'insights' ? 'Insights'
    : t.tt === 'kpi' ? `KPI · ${SD_KPI_LABEL[t.tk] ?? t.tk}`
    : t.tt === 'program' ? `Program · ${monthLabel(t.tk)}`
    : t.tt === 'week' ? `Week · ${prRangeShort(t.tk, prAddDays(t.tk, 6))}`
    : `Creator · ${creators.find(c => c.id === t.tk)?.name ?? t.tk}`;

  if (threads.length === 0) {
    return <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">💬</div><h3>No discussions yet</h3><p>Leave a comment from the Programs or Performance tab — your conversation with the team shows up here.</p></div></div>;
  }
  return (
    <div>
      <div className="pc-rd-weeks" style={{ marginBottom: 14 }}>
        {SD_LEVELS.filter(l => l.id === 'all' || counts[l.id]).map(l => (
          <button key={l.id} className={`pc-rd-week ${lvl === l.id ? 'active' : ''}`} onClick={() => setLvl(l.id)}>
            {l.label}{counts[l.id] ? <span className="pc-rd-week-n" style={{ marginLeft: 5 }}>{counts[l.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="pc-card" style={{ padding: 6 }}>
        {shown.map(t => (
          <button key={`${t.tt}|${t.tk}`} className="pc-disc-row" onClick={() => onOpen(t.tt, t.tk, t.last.id)}>
            <span className="pc-ava" style={{ background: getGradient(brand.name), width: 34, height: 34, fontSize: 14, borderRadius: 10, flex: '0 0 auto' }}>{initial(brand.name)}</span>
            <div className="pc-disc-main">
              <div className="pc-disc-top"><span className="pc-disc-tag">{tlabel(t)}</span></div>
              <div className="pc-disc-prev"><b>{t.last.author_name}:</b> {t.last.body}</div>
            </div>
            <div className="pc-disc-right">
              {t.newReply && <span className="pc-rd-pill prog">New reply</span>}
              <span className="pcc-count">{t.count}</span>
              <span className="pc-disc-time">{sdShortDate(t.last.created_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Performance sub-tab — client-facing reporting dashboard (read-only).
   Mirrors the handler's Internal Reporting: Monthly/Weekly lens, week selector,
   KPI tiles, GMV vs Ad area chart, payment mix, top creators + insights.
════════════════════════════════════════════════════════════ */
const PR_STATUS: Record<string, { label: string; cls: string; color: string }> = {
  videos_in_progress: { label: 'In progress', cls: 'prog', color: '#1259C3' },
  pending:            { label: 'Pending',     cls: 'pend', color: '#E8862E' },
  paid:               { label: 'Paid',        cls: 'paid', color: '#198754' },
};
const prAddDays = (k: string, n: number) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const prRangeShort = (s: string, e: string) => { const a = new Date(s + 'T00:00:00'), b = new Date(e + 'T00:00:00'); const am = a.toLocaleDateString('en-US', { month: 'short' }), bm = b.toLocaleDateString('en-US', { month: 'short' }); return am === bm ? `${am} ${a.getDate()}–${b.getDate()}` : `${am} ${a.getDate()} – ${bm} ${b.getDate()}`; };
const prRangeLong = (s: string, e: string) => { const f = (k: string) => new Date(k + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return `${f(s)} – ${f(e)}`; };
const prMonthShort = (k: string) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

function PerformanceReport({ brand, creators, onDiscuss }: {
  brand: BrandLite; creators: HandlerCreator[];
  onDiscuss?: (tt: string, tk: string) => void;
}) {
  const [mode, setMode] = useState<'monthly' | 'weekly'>('weekly');
  const [weekSel, setWeekSel] = useState<string | null>(null);
  const isWeekly = mode === 'weekly';

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
        <div className="pc-rd-weeks">
          <span className="pc-rd-weeks-l"><i className="bi bi-calendar3" /> Week</span>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          {weekKeys.length === 0 ? (
            <span className="pc-rd-weeks-none">No weekly data yet</span>
          ) : weekKeys.map((k, i) => (
            <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)} title={prRangeLong(k, prAddDays(k, 6))}>
              <span className="pc-rd-week-n">W{i + 1}</span>{prRangeShort(k, prAddDays(k, 6))}
            </button>
          ))}
        </div>
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
