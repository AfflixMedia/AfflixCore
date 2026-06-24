import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { setCreatorVideoAuth } from '../handler-collab/store';
import type { HandlerBrandMonth, HandlerCreator } from '../handler-collab/store';
import { BrandPerformancePane } from '../handler-collab/HandlerCollabApp';
import {
  fmt$, monthKey, monthLabel, focusProductList, deliveredCount,
  Kpi, CreatorRowRO, CreatorListHeadRO,
} from '../paid-collab/handlerCollabReadonly';

interface Props {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}

/* ════════════════════════════════════════════════════════════
   Paid Collab tab for THIS brand, styled like the handler Workspace drilldown (pc-*
   via handlerCollab.css). Keyed by public.brands.id, so it works for Bob / APC /
   handler / client via RLS (user_has_brand_access).
   - Overview: read-only summary (budgets/briefs + creator list) of the handler data.
   - Performance: the same editable GMV matrix (monthly/weekly) the handler has, shown
     to staff who may edit (canEdit = Bob or the assigned APC, brand active). Writes go
     through store.setCreatorMonthly (SECURITY DEFINER RPC, so APCs can write too).
   Creator/budget editing still happens in the handler's own workspace.
════════════════════════════════════════════════════════════ */
export default function BrandPaidCollabTab({ brandId, brandName, canEdit }: Props) {
  const [months, setMonths] = useState<HandlerBrandMonth[]>([]);
  const [creators, setCreators] = useState<HandlerCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Overview = the read-only summary below; Performance = the editable GMV matrix
  // (monthly/weekly), available to staff who may edit (Bob / assigned APC).
  const [view, setView] = useState<'overview' | 'performance'>('overview');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      const [{ data: mRows, error: mErr }, { data: cRows, error: cErr }] = await Promise.all([
        supabase.from('handler_collab_brand_months').select('*').eq('brand_id', brandId),
        supabase.from('handler_collab_creators').select('*').eq('brand_id', brandId),
      ]);
      if (cancelled) return;
      if (mErr || cErr) { setErr((mErr ?? cErr)!.message); setLoading(false); return; }
      setMonths((mRows ?? []) as HandlerBrandMonth[]);
      setCreators((cRows ?? []) as HandlerCreator[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  const totals = useMemo(() => {
    let budget = 0;
    months.forEach(m => { budget += Number(m.budget) || 0; });
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    creators.forEach(c => {
      allocated += Number(c.amount) || 0;
      if (c.payment_status === 'paid') paid += Number(c.amount) || 0;
      videos += Number(c.videos_count) || 0;
      delivered += deliveredCount(c);
    });
    return { budget, allocated, paid, videos, delivered };
  }, [months, creators]);

  // Toggle a video's "Authorised" flag (APC/Bob). Optimistic; reverts on failure.
  const handleToggleAuth = useCallback(async (creatorId: string, index: number, auth: boolean) => {
    const apply = (val: boolean) => setCreators(prev => prev.map(c => {
      if (c.id !== creatorId) return c;
      const codes = Array.isArray(c.video_codes) ? c.video_codes.slice() : [];
      if (codes[index]) codes[index] = { ...codes[index], auth: val };
      return { ...c, video_codes: codes };
    }));
    apply(auth);
    try {
      await setCreatorVideoAuth(creatorId, index, auth);
    } catch (e) {
      apply(!auth); // revert
      alert(`Couldn't update authorised status: ${(e as Error).message}`);
    }
  }, []);

  const sortedMonths = useMemo(
    () => [...months].sort((a, b) => String(b.month).localeCompare(String(a.month))),
    [months],
  );

  // Creators grouped by onboarded month (newest first), like the workspace.
  const groups = useMemo(() => {
    const map: Record<string, HandlerCreator[]> = {};
    creators.forEach(c => { const k = monthKey(c.onboarded_on); (map[k] = map[k] || []).push(c); });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(k => ({
      key: k,
      items: map[k].sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))),
    }));
  }, [creators]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const costPerVideo = totals.delivered > 0 ? totals.allocated / totals.delivered : 0;

  const overview = (months.length === 0 && creators.length === 0) ? (
    <div className="pc-card"><div className="pc-empty">
      <div className="pc-empty-icon">👥</div>
      <h3>No paid collab data for {brandName}</h3>
      <p>Enable the “Paid Collabs” scope for this brand and assign it to a handler — their workspace data shows here.</p>
    </div></div>
  ) : (
    <>
      <div className="pc-kpis pc-kpis-5">
        <Kpi label="Budget" color="#1259C3" value={fmt$(totals.budget)} sub={`${months.length} month${months.length === 1 ? '' : 's'}`} />
        <Kpi label="Allocated" color="#8B5CF6" value={fmt$(totals.allocated)} sub={`${creators.length} creator${creators.length === 1 ? '' : 's'}`} />
        <Kpi label="Paid" color="#2E7D32" value={fmt$(totals.paid)} sub={`${totals.allocated > 0 ? Math.round((totals.paid / totals.allocated) * 100) : 0}% paid out`} />
        <Kpi label="Videos" color="#0EA5E9" value={`${totals.delivered}/${totals.videos}`} sub={`${totals.videos > 0 ? Math.round((totals.delivered / totals.videos) * 100) : 0}% completed`} />
        <Kpi label="Cost / Video" color="#E65100" value={costPerVideo ? fmt$(costPerVideo) : '—'} sub="per delivered video" />
      </div>

      {sortedMonths.length > 0 && (
        <div className="pc-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Monthly budgets &amp; briefs</div>
          {sortedMonths.map(m => {
            const products = focusProductList(m.focus_product_url);
            return (
              <div key={m.id} style={{ marginBottom: 10 }}>
                <div className="pc-dd-links">
                  <span className="pc-link-chip set">{monthLabel(m.month)} · {fmt$(Number(m.budget) || 0)}</span>
                  {m.content_guide_url && <a className="pc-link-chip" href={m.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>}
                  {products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer">{p.name || `Focus product ${i + 1}`} ↗</a>)}
                </div>
                {m.notes && m.notes.trim() && <div className="pc-kpi-sub" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.notes}</div>}
              </div>
            );
          })}
        </div>
      )}

      {creators.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👤</div><h3>No creators yet</h3>
        </div></div>
      ) : (
        <div className="pc-card pc-list">
          <CreatorListHeadRO />
          {groups.map(g => (
            <Fragment key={g.key}>
              <div className="pc-cv-monthhead"><span>{monthLabel(g.key)}</span><span className="pc-cv-monthcount">{g.items.length}</span></div>
              {g.items.map((c, i) => <CreatorRowRO key={c.id} c={c} idx={i + 1}
                onToggleAuth={(vi, a) => handleToggleAuth(c.id, vi, a)} />)}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      {canEdit && (
        <div className="pc-seg" style={{ marginBottom: 16 }}>
          <button type="button" className={`pc-seg-btn ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
          <button type="button" className={`pc-seg-btn ${view === 'performance' ? 'active' : ''}`} onClick={() => setView('performance')}>Performance</button>
        </div>
      )}
      {canEdit && view === 'performance'
        ? <BrandPerformancePane brandId={brandId} brandName={brandName} canEdit={canEdit} />
        : overview}
    </div>
  );
}
