import { useMemo, useState } from 'react';
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

export default function SharedHandlerCollabPane({ brand, months, creators }: {
  brand: BrandLite; months: HandlerBrandMonth[]; creators: HandlerCreator[];
}) {
  const [section, setSection] = useState<'programs' | 'performance'>('programs');
  const [openMonth, setOpenMonth] = useState<string | null>(null);

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
            <CreatorStatusGroupsRO creators={mc} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="pc-tabs" style={{ marginBottom: 16 }}>
        <button className={`pc-tab ${section === 'programs' ? 'active' : ''}`} onClick={() => setSection('programs')}>Programs</button>
        <button className={`pc-tab ${section === 'performance' ? 'active' : ''}`} onClick={() => setSection('performance')}>Performance</button>
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
      ) : (
        <PerformanceReport brand={brand} creators={bCreators} />
      )}
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

function PerformanceReport({ brand, creators }: { brand: BrandLite; creators: HandlerCreator[] }) {
  const [mode, setMode] = useState<'monthly' | 'weekly'>('monthly');
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
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Insights</span></div>
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
