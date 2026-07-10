import { useEffect, useMemo, useState } from 'react';
import PaidCollabDiscussionDrawer from '../paidcollab/PaidCollabDiscussionDrawer';
import type { PaidCollabComment } from '../../pages/handler-collab/store';
import type { HandlerBrandMonth, HandlerCreator } from '../../pages/handler-collab/store';
import {
  fmt$, getGradient, initial, monthKey, monthLabel, focusProductList,
  deliveredCount, gmvSum, isPendingVisible, Kpi, CreatorListHeadRO, CreatorStatusGroupsRO,
  PerformanceReport, prAddDays, prRangeShort,
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
  // Programs month filter — current month / previous month / all (mirrors the weekly tab).
  const [monthFilter, setMonthFilter] = useState<'current' | 'prev' | 'all'>('all');
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

  // Month-filter keys (YYYY-MM): current month + the month before it.
  const curYM = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, []);
  const prevYM = useMemo(() => { const d = new Date(); const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`; }, []);
  const shownRows = useMemo(
    () => monthFilter === 'all' ? programRows : programRows.filter(r => r.m.month === (monthFilter === 'current' ? curYM : prevYM)),
    [programRows, monthFilter, curYM, prevYM],
  );

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
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{brand.name}</div>
              </div>
              <div className="pc-rd-weeks" style={{ marginLeft: 'auto' }}>
                {([
                  { id: 'current', label: monthLabel(curYM) },
                  { id: 'prev', label: monthLabel(prevYM) },
                  { id: 'all', label: 'All' },
                ] as const).map(opt => {
                  const n = opt.id === 'all' ? programRows.length
                    : programRows.filter(r => r.m.month === (opt.id === 'current' ? curYM : prevYM)).length;
                  return (
                    <button key={opt.id} className={`pc-rd-week ${monthFilter === opt.id ? 'active' : ''}`} onClick={() => setMonthFilter(opt.id)}>
                      {opt.label}{n ? <span className="pc-rd-week-n" style={{ marginLeft: 5 }}>{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {shownRows.length === 0 ? (
              <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">🗓️</div><h3>No programs in {monthFilter === 'current' ? monthLabel(curYM) : monthLabel(prevYM)}</h3></div></div>
            ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shownRows.map(r => (
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
            )}
          </>
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
