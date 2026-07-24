import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import * as store from '../handler-collab/store';
import type { HandlerCreator, HandlerBrandMonth, PaidCollabComment } from '../handler-collab/store';
import {
  PillRow, getGradient, initial, monthKey, monthLabel, fmt$,
  deliveredCount, gmvSum, isPendingVisible, focusProductList,
  Kpi, CreatorListHeadRO, CreatorStatusGroupsRO, prAddDays, prRangeShort,
} from './handlerCollabReadonly';
import { setReportCurrency } from '../../lib/currency';

export interface BrandLite { id: string; name: string; client: string | null; currency?: string | null }

export const KPI_LABEL: Record<string, string> = {
  active_creators: 'Active creators', videos_posted: 'Videos posted', pipeline: 'In pipeline', gmv: 'GMV generated', ad: 'Ad spend',
};

/* Shared data for the paid-collab CLIENT views (dashboard + Programs page).
   Loads the client's brands and the current handler-collab model rows (RLS-scoped). */
export function useClientWorkspaceData() {
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [creators, setCreators] = useState<HandlerCreator[]>([]);
  const [months, setMonths] = useState<HandlerBrandMonth[]>([]);
  const [comments, setComments] = useState<PaidCollabComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const { data: bRows, error: bErr } = await supabase
        .from('brands').select('id,name,client,currency').contains('scope', ['paid_creator']).order('name');
      if (bErr) { setErr(bErr.message); setLoading(false); return; }
      const bs = (bRows || []) as BrandLite[];
      setBrands(bs);
      if (bs.length === 0) { setLoading(false); return; }
      const ids = bs.map(b => b.id);
      const [{ data: cRows, error: cErr }, { data: mRows, error: mErr }] = await Promise.all([
        supabase.from('handler_collab_creators').select('*').in('brand_id', ids),
        supabase.from('handler_collab_brand_months').select('*').in('brand_id', ids),
      ]);
      if (cErr || mErr) { setErr((cErr ?? mErr)!.message); setLoading(false); return; }
      setCreators((cRows || []) as HandlerCreator[]);
      setMonths((mRows || []) as HandlerBrandMonth[]);
      try { setComments(await store.loadComments(ids)); } catch { /* discussions optional */ }
      setLoading(false);
    })();
  }, []);

  // Client "mark payment as done" — optimistic local patch.
  const confirmPaid = async (creatorId: string, confirmed: boolean) => {
    const updated = await store.setClientPaid(creatorId, confirmed);
    setCreators(prev => prev.map(c => c.id === creatorId
      ? { ...c, client_paid_confirmed_at: updated.client_paid_confirmed_at, client_paid_confirmed_name: updated.client_paid_confirmed_name }
      : c));
  };
  // Post a comment as the signed-in client.
  const addComment = async (brandId: string, tt: string, tk: string, body: string, parentId?: string) => {
    const row = await store.addClientComment({ brandId, targetType: tt as any, targetKey: tk || '', body, parentId: parentId || null });
    setComments(prev => [...prev, row]);
  };

  return { brands, creators, months, comments, loading, err, setCreators, setComments, confirmPaid, addComment };
}

/* Brand switcher pill row (scrolls horizontally with nav arrows). */
export function BrandSwitch({ brands, value, onChange }: { brands: BrandLite[]; value: string; onChange: (v: string) => void }) {
  if (brands.length <= 1) return null;
  return (
    <PillRow label={<><i className="bi bi-shop" /> Brand</>} className="pcd-brand-switch">
      <button className={`pc-rd-week ${value === 'all' ? 'active' : ''}`} onClick={() => onChange('all')}>All brands</button>
      {brands.map(b => (
        <button key={b.id} className={`pc-rd-week ${value === b.id ? 'active' : ''}`} onClick={() => onChange(b.id)}>
          <span className="pcd-brand-dot" style={{ background: getGradient(b.name) }}>{initial(b.name)}</span>
          {b.name}
        </button>
      ))}
    </PillRow>
  );
}

/* ── Programs: brand-month list (payment-pending first) → program detail w/ pay-confirm ── */
export function ProgramsView({ months, creators, brandById, showBrand, openProgram, setOpenProgram, onConfirmPaid, onDiscuss }: {
  months: HandlerBrandMonth[]; creators: HandlerCreator[]; brandById: Map<string, BrandLite>;
  showBrand: boolean; openProgram: { brandId: string; month: string } | null;
  setOpenProgram: (v: { brandId: string; month: string } | null) => void;
  onConfirmPaid: (creatorId: string, confirmed: boolean) => Promise<void>;
  onDiscuss: (brandId: string, tt: string, tk: string) => void;
}) {
  const rows = useMemo(() => months.map(m => {
    const mc = creators.filter(c => c.brand_id === m.brand_id && monthKey(c.onboarded_on) === m.month);
    let allocated = 0, videos = 0, delivered = 0, gmv = 0, pendingCount = 0;
    mc.forEach(c => { allocated += Number(c.amount) || 0; videos += Number(c.videos_count) || 0; delivered += deliveredCount(c); gmv += gmvSum(c); if (isPendingVisible(c)) pendingCount += 1; });
    return { m, brand: brandById.get(m.brand_id), creators: mc.length, budget: Number(m.budget) || 0, allocated, videos, delivered, gmv, pendingCount };
  })
    // Payment-pending programs surface at the top, then newest month first.
    .sort((a, b) => (Number(b.pendingCount > 0) - Number(a.pendingCount > 0)) || String(b.m.month).localeCompare(String(a.m.month))),
  [months, creators, brandById]);

  if (openProgram) {
    const m = months.find(x => x.brand_id === openProgram.brandId && x.month === openProgram.month);
    const brand = brandById.get(openProgram.brandId);
    const mc = creators.filter(c => c.brand_id === openProgram.brandId && monthKey(c.onboarded_on) === openProgram.month)
      .sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || '')));
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    mc.forEach(c => { allocated += Number(c.amount) || 0; if (c.payment_status === 'paid') paid += Number(c.amount) || 0; videos += Number(c.videos_count) || 0; delivered += deliveredCount(c); });
    const budget = Number(m?.budget) || 0;
    const usage = budget > 0 ? Math.round((allocated / budget) * 100) : 0;
    const cpv = videos > 0 ? allocated / videos : 0;
    const products = m ? focusProductList(m.focus_product_url) : [];
    setReportCurrency(brand?.currency); // money symbol for this brand's region
    return (
      <div>
        <button className="pc-back" onClick={() => setOpenProgram(null)}>‹ All programs</button>
        <div className="pc-dd-head">
          <span className="pc-ava" style={{ background: getGradient(brand?.name || '') }}>{initial(brand?.name || '')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="pc-dd-title">{brand?.name || 'Brand'}</h2>
            <div className="pc-dd-sub">{monthLabel(openProgram.month)}{brand?.client ? ` · ${brand.client}` : ''}</div>
            <div className="pc-dd-links">
              {m?.content_guide_url && <a className="pc-link-chip set" href={m.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>}
              {products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer">{p.name || `Focus product ${i + 1}`} ↗</a>)}
            </div>
          </div>
          <div className="pc-dd-actions">
            <button className="pc-disc-btn" style={{ height: 34 }} onClick={() => onDiscuss(openProgram.brandId, 'program', openProgram.month)}>
              <i className="bi bi-chat-left-text" />Discussion
            </button>
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
          <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">👤</div><h3>No creators in {monthLabel(openProgram.month)}</h3></div></div>
        ) : (
          <div className="pc-card pc-list">
            <CreatorListHeadRO />
            <CreatorStatusGroupsRO creators={mc} onConfirmPaid={onConfirmPaid} />
          </div>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">🗂️</div><h3>No programs yet</h3></div></div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(r => (
        <div key={r.m.id} className={`pc-card pc-prog-card ${r.pendingCount > 0 ? 'pc-prog-pending' : ''}`} role="button" tabIndex={0}
          style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
          onClick={() => setOpenProgram({ brandId: r.m.brand_id, month: r.m.month })}
          onKeyDown={e => { if (e.key === 'Enter') setOpenProgram({ brandId: r.m.brand_id, month: r.m.month }); }}>
          <span className="pc-ava" style={{ background: getGradient(r.brand?.name || '') }}>{initial(r.brand?.name || '')}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {showBrand ? `${r.brand?.name || 'Brand'} · ${monthLabel(r.m.month)}` : monthLabel(r.m.month)}
              {r.pendingCount > 0 && (
                <span className="pc-prog-pendpill"><span className="pc-statusdot pending" />Payment pending{r.pendingCount > 1 ? ` · ${r.pendingCount}` : ''}</span>
              )}
            </div>
            <div className="pc-kpi-sub">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} videos</div>
          </div>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{fmt$(r.budget, r.brand?.currency)}</div><div className="pc-kpi-sub">budget</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{fmt$(r.allocated, r.brand?.currency)}</div><div className="pc-kpi-sub">allocated</div></div>
          <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }} className="pc-green">{r.gmv ? fmt$(r.gmv, r.brand?.currency) : '—'}</div><div className="pc-kpi-sub">GMV</div></div>
          <span className="pc-chev">›</span>
        </div>
      ))}
    </div>
  );
}

/* ── Discussions: all threads in scope → open drawer ── */
function shortDate(iso: string) {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function DiscussionsView({ comments, brandById, creatorById, seenAt, showBrand, concreteBrand, onOpen }: {
  comments: PaidCollabComment[]; brandById: Map<string, BrandLite>; creatorById: Map<string, HandlerCreator>;
  seenAt: number; showBrand: boolean; concreteBrand: BrandLite | null;
  onOpen: (brandId: string, tt: string, tk: string, highlight?: string) => void;
}) {
  const threads = useMemo(() => {
    const map = new Map<string, { brandId: string; tt: string; tk: string; items: PaidCollabComment[] }>();
    comments.forEach(c => {
      const k = `${c.brand_id}|${c.target_type}|${c.target_key}`;
      let t = map.get(k);
      if (!t) { t = { brandId: c.brand_id, tt: c.target_type, tk: c.target_key, items: [] }; map.set(k, t); }
      t.items.push(c);
    });
    return [...map.values()].map(t => {
      const sorted = t.items.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const last = sorted[sorted.length - 1];
      const newReply = last.author_type !== 'client' && new Date(last.created_at).getTime() > seenAt;
      return { ...t, count: t.items.length, last, newReply };
    }).sort((a, b) => (Number(b.newReply) - Number(a.newReply)) || String(b.last.created_at).localeCompare(String(a.last.created_at)));
  }, [comments, seenAt]);

  const tlabel = (t: { tt: string; tk: string }) => t.tt === 'brand' ? 'Whole brand' : t.tt === 'insights' ? 'Insights'
    : t.tt === 'kpi' ? `KPI · ${KPI_LABEL[t.tk] ?? t.tk}`
    : t.tt === 'program' ? `Program · ${monthLabel(t.tk)}`
    : t.tt === 'week' ? `Week · ${prRangeShort(t.tk, prAddDays(t.tk, 6))}`
    : `Creator · ${creatorById.get(t.tk)?.name ?? t.tk}`;

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
        <div className="pc-kpi-sub" style={{ fontSize: 13 }}>
          {threads.length === 0 ? 'No discussions yet.' : `${threads.length} discussion${threads.length === 1 ? '' : 's'}`}
        </div>
        {concreteBrand ? (
          <button className="pc-disc-btn" style={{ height: 34 }} onClick={() => onOpen(concreteBrand.id, 'brand', '')}>
            <i className="bi bi-chat-left-text" />Start a discussion
          </button>
        ) : (
          <span className="pc-kpi-sub"><i className="bi bi-info-circle me-1" />Select a single brand above to start a new discussion.</span>
        )}
      </div>

      {threads.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">💬</div>
          <h3>No discussions yet</h3>
          <p>{concreteBrand ? 'Start a conversation with the team about your paid collab data.' : 'Pick a single brand above, then start a conversation with the team.'}</p>
        </div></div>
      ) : (
        <div className="pc-card" style={{ padding: 6 }}>
          {threads.map(t => (
            <button key={`${t.brandId}|${t.tt}|${t.tk}`} className="pc-disc-row" onClick={() => onOpen(t.brandId, t.tt, t.tk, t.last.id)}>
              <span className="pc-ava" style={{ background: getGradient(brandById.get(t.brandId)?.name || ''), width: 34, height: 34, fontSize: 14, borderRadius: 10, flex: '0 0 auto' }}>{initial(brandById.get(t.brandId)?.name || '')}</span>
              <div className="pc-disc-main">
                <div className="pc-disc-top">
                  {showBrand && <span className="pc-disc-tag" style={{ background: '#eef2ff', color: '#3949ab' }}>{brandById.get(t.brandId)?.name ?? 'Brand'}</span>}
                  <span className="pc-disc-tag">{tlabel(t)}</span>
                </div>
                <div className="pc-disc-prev"><b>{t.last.author_name}:</b> {t.last.body}</div>
              </div>
              <div className="pc-disc-right">
                {t.newReply && <span className="pc-rd-pill prog">New reply</span>}
                <span className="pcc-count">{t.count}</span>
                <span className="pc-disc-time">{shortDate(t.last.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
