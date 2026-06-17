import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import type { HandlerBrandMonth, HandlerCreator } from '../handler-collab/store';
import {
  fmt$, getGradient, initial, monthKey, monthLabel, focusProductList,
  deliveredCount, Kpi, CreatorRowRO, CreatorListHeadRO,
} from './handlerCollabReadonly';

/**
 * One program = one brand-month (new schema). Renders the SAME visual as the handler
 * Workspace brand drilldown (pc-* styling) but READ-ONLY. RLS (user_has_brand_access)
 * blocks access if the viewer isn't assigned the brand.
 */
interface Brand { id: string; name: string; client: string }

export default function PaidCollabProgramView() {
  const { programId } = useParams<{ programId: string }>();
  const nav = useNavigate();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [bm, setBm] = useState<HandlerBrandMonth | null>(null);
  const [creators, setCreators] = useState<HandlerCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      const { data: m, error: mErr } = await supabase
        .from('handler_collab_brand_months').select('*').eq('id', programId).maybeSingle();
      if (cancelled) return;
      if (mErr) { setErr(mErr.message); setLoading(false); return; }
      if (!m) { setErr('Program not found or you do not have access.'); setLoading(false); return; }
      const month = m as HandlerBrandMonth;
      const [{ data: b, error: bErr }, { data: cRows, error: cErr }] = await Promise.all([
        supabase.from('brands').select('id,name,client').eq('id', month.brand_id).maybeSingle(),
        supabase.from('handler_collab_creators').select('*').eq('brand_id', month.brand_id),
      ]);
      if (cancelled) return;
      if (bErr || cErr) { setErr((bErr ?? cErr)!.message); setLoading(false); return; }
      setBm(month);
      setBrand((b as Brand) ?? null);
      setCreators(((cRows ?? []) as HandlerCreator[]).filter(c => monthKey(c.onboarded_on) === month.month));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [programId]);

  const agg = useMemo(() => {
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    creators.forEach(c => {
      allocated += Number(c.amount) || 0;
      if (c.payment_status === 'paid') paid += Number(c.amount) || 0;
      videos += Number(c.videos_count) || 0;
      delivered += deliveredCount(c);
    });
    return { allocated, paid, videos, delivered };
  }, [creators]);

  const sorted = useMemo(
    () => [...creators].sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))),
    [creators],
  );

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand || !bm) return null;

  const budget = Number(bm.budget) || 0;
  const usage = budget > 0 ? Math.round((agg.allocated / budget) * 100) : 0;
  const products = focusProductList(bm.focus_product_url);
  const costPerVideo = agg.delivered > 0 ? agg.allocated / agg.delivered : 0;

  return (
    <div className="pc-app">
      <div className="pc-shell">
        <button className="pc-back" onClick={() => nav(-1)}>‹ Back</button>
        <div className="pc-dd-head">
          <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="pc-dd-title">{brand.name}</h2>
            <div className="pc-dd-sub">{monthLabel(bm.month)}{brand.client ? ` · ${brand.client}` : ''}</div>
            <div className="pc-dd-links">
              {bm.content_guide_url && <a className="pc-link-chip set" href={bm.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>}
              {products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer">{p.name || `Focus product ${i + 1}`} ↗</a>)}
            </div>
          </div>
        </div>

        <div className="pc-kpis pc-kpis-5">
          <Kpi label="Budget" color="#1259C3" value={budget ? fmt$(budget) : '—'} sub={budget ? `${usage}% used` : 'not set'} />
          <Kpi label="Allocated" color="#8B5CF6" value={fmt$(agg.allocated)} sub={`${creators.length} creator${creators.length === 1 ? '' : 's'}`} />
          <Kpi label="Paid" color="#2E7D32" value={fmt$(agg.paid)} sub={`${agg.allocated > 0 ? Math.round((agg.paid / agg.allocated) * 100) : 0}% paid out`} />
          <Kpi label="Videos" color="#0EA5E9" value={`${agg.delivered}/${agg.videos}`} sub={`${agg.videos > 0 ? Math.round((agg.delivered / agg.videos) * 100) : 0}% completed`} />
          <Kpi label="Cost / Video" color="#E65100" value={costPerVideo ? fmt$(costPerVideo) : '—'} sub="per delivered video" />
        </div>

        {bm.notes && bm.notes.trim() && (
          <div className="pc-card" style={{ padding: 16, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{bm.notes}</div>
        )}

        {creators.length === 0 ? (
          <div className="pc-card"><div className="pc-empty">
            <div className="pc-empty-icon">👤</div><h3>No creators in {monthLabel(bm.month)}</h3>
          </div></div>
        ) : (
          <div className="pc-card pc-list">
            <CreatorListHeadRO />
            {sorted.map((c, i) => <CreatorRowRO key={c.id} c={c} idx={i + 1} />)}
          </div>
        )}
      </div>
    </div>
  );
}
