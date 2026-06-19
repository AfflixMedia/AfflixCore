import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { HandlerBrandMonth, HandlerCreator } from '../../pages/handler-collab/store';
import {
  fmt$, getGradient, initial, monthKey, monthLabel, focusProductList,
  deliveredCount, gmvSum, isPendingVisible, Kpi, CreatorListHeadRO, CreatorStatusGroupsRO,
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

  // Calendar-month GMV / Ad aggregation across every creator's monthly data → chart series.
  const perfSeries = useMemo(() => {
    const agg: Record<string, { gmv: number; ad: number }> = {};
    bCreators.forEach(c => {
      const m = c.monthly || {};
      Object.keys(m).forEach(k => {
        if (!/^\d{4}-\d{2}$/.test(k)) return;
        agg[k] = agg[k] || { gmv: 0, ad: 0 };
        agg[k].gmv += Number((m as any)[k]?.gmv) || 0;
        agg[k].ad += Number((m as any)[k]?.adSpent) || 0;
      });
    });
    return Object.keys(agg).sort().map(k => ({
      label: monthLabel(k), gmv: agg[k].gmv, ad: agg[k].ad,
      roas: agg[k].ad > 0 ? +(agg[k].gmv / agg[k].ad).toFixed(2) : 0,
    }));
  }, [bCreators]);

  const totals = useMemo(() => {
    let gmv = 0, ad = 0; perfSeries.forEach(s => { gmv += s.gmv; ad += s.ad; });
    let budget = 0; bMonths.forEach(m => { budget += Number(m.budget) || 0; });
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    bCreators.forEach(c => {
      allocated += Number(c.amount) || 0;
      if (c.payment_status === 'paid') paid += Number(c.amount) || 0;
      videos += Number(c.videos_count) || 0;
      delivered += deliveredCount(c);
    });
    return { gmv, ad, roas: ad > 0 ? gmv / ad : 0, budget, allocated, paid, videos, delivered };
  }, [perfSeries, bMonths, bCreators]);

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
        <>
          <div className="pc-kpis pc-kpis-5">
            <Kpi label="Total GMV" color="#2E7D32" value={fmt$(totals.gmv)} sub="for this brand" />
            <Kpi label="Total Ad Spent" color="#C62828" value={fmt$(totals.ad)} sub="across months" />
            <Kpi label="ROAS" color="#1259C3" value={totals.roas ? `${totals.roas.toFixed(2)}x` : '—'} sub="GMV / ad spend" />
            <Kpi label="Videos" color="#0EA5E9" value={`${totals.delivered}/${totals.videos}`} sub="delivered / agreed" />
            <Kpi label="Allocated" color="#8B5CF6" value={fmt$(totals.allocated)} sub={`${bCreators.length} creator${bCreators.length === 1 ? '' : 's'}`} />
          </div>
          <div className="pc-card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Monthly GMV vs Ad Spend</div>
            {perfSeries.length === 0 ? (
              <div className="pc-empty"><div className="pc-empty-icon">📈</div><h3>No performance data yet</h3><p>GMV / ad spend appears here once the handler logs monthly figures.</p></div>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={perfSeries} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ECECEC" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number, n: string) => (n === 'ROAS' ? `${v}x` : fmt$(v))} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="gmv" name="GMV" fill="#2E7D32" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="ad" name="Ad Spend" fill="#C62828" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" dataKey="roas" name="ROAS" stroke="#1259C3" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
