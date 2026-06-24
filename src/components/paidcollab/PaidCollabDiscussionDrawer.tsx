import { useMemo, useState } from 'react';
import PaidCollabComments from './PaidCollabComments';
import type { HandlerCreator, HandlerBrandMonth, PaidCollabComment } from '../../pages/handler-collab/store';
import { monthLabel, monthKey, getGradient } from '../../pages/paid-collab/handlerCollabReadonly';

/* Right-side discussion drawer for one brand — all comment levels in one place
   (brand / insights / kpi / program / week / creator). Shared by the handler
   workspace (mode="authed") and the public client share link (mode="public"). */
const DISC_KPIS = [
  { id: 'active_creators', label: 'Active creators' }, { id: 'videos_posted', label: 'Videos posted' },
  { id: 'pipeline', label: 'In pipeline' }, { id: 'gmv', label: 'GMV generated' }, { id: 'ad', label: 'Ad spend' },
];
const DISC_TYPES = [
  { id: 'brand', label: 'Brand' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
  { id: 'program', label: 'Program' }, { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' },
];
const dAdd = (k: string, n: number) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dRange = (s: string) => { const a = new Date(s + 'T00:00:00'), b = new Date(dAdd(s, 6) + 'T00:00:00'); const am = a.toLocaleDateString('en-US', { month: 'short' }), bm = b.toLocaleDateString('en-US', { month: 'short' }); return am === bm ? `${am} ${a.getDate()}–${b.getDate()}` : `${am} ${a.getDate()} – ${bm} ${b.getDate()}`; };

export interface DiscDrawerProps {
  brand: { id: string; name: string };
  comments: PaidCollabComment[];
  creators: HandlerCreator[];
  months: HandlerBrandMonth[];
  mode: 'public' | 'authed';
  currentName?: string;       // authed display name
  publicName?: string;        // remembered public (client) name
  initial?: { tt?: string; tk?: string; highlight?: string };
  onAdd: (tt: string, tk: string, body: string, authorName: string, parentId?: string) => Promise<void>;
  onClose: () => void;
}

export default function PaidCollabDiscussionDrawer({ brand, comments, creators, months, mode, currentName, publicName, initial = {}, onAdd, onClose }: DiscDrawerProps) {
  const [tt, setTt] = useState(initial.tt || 'brand');
  const [tk, setTk] = useState(initial.tk || '');

  const bComments = useMemo(() => comments.filter(c => c.brand_id === brand.id), [comments, brand.id]);
  const brandCreators = useMemo(() => creators.filter(c => c.brand_id === brand.id), [creators, brand.id]);
  const monthList = useMemo(() => {
    const set = new Set<string>();
    months.filter(m => m.brand_id === brand.id).forEach(m => set.add(m.month));
    brandCreators.forEach(c => { const k = monthKey(c.onboarded_on); if (k) set.add(k); });
    return [...set].sort().reverse();
  }, [months, brandCreators, brand.id]);
  const weekList = useMemo(() => {
    const set = new Set<string>();
    brandCreators.forEach(c => Object.keys((c.monthly as any)?.weeks || {}).forEach(k => set.add(k)));
    return [...set].sort();
  }, [brandCreators]);

  const needsKey = tt === 'kpi' || tt === 'program' || tt === 'week' || tt === 'creator';
  const keyOptions = tt === 'kpi' ? DISC_KPIS.map(k => ({ value: k.id, label: k.label }))
    : tt === 'program' ? monthList.map(m => ({ value: m, label: monthLabel(m) }))
    : tt === 'week' ? weekList.map(w => ({ value: w, label: dRange(w) }))
    : tt === 'creator' ? brandCreators.map(c => ({ value: c.id, label: c.name })) : [];

  function pickType(nt: string) {
    setTt(nt);
    if (nt === 'brand' || nt === 'insights') { setTk(''); return; }
    const opts = nt === 'kpi' ? DISC_KPIS.map(k => k.id)
      : nt === 'program' ? monthList : nt === 'week' ? weekList : brandCreators.map(c => c.id);
    setTk(opts[0] || '');
  }

  const title = tt === 'brand' ? `Whole brand · ${brand.name}`
    : tt === 'insights' ? 'Insights'
    : tt === 'kpi' ? `KPI · ${DISC_KPIS.find(k => k.id === tk)?.label ?? ''}`
    : tt === 'program' ? `Program · ${tk ? monthLabel(tk) : ''}`
    : tt === 'week' ? `Week · ${tk ? dRange(tk) : ''}`
    : `Creator · ${brandCreators.find(c => c.id === tk)?.name ?? ''}`;

  const threads = useMemo(() => {
    const m = new Map<string, number>();
    bComments.forEach(c => { const k = `${c.target_type}|${c.target_key}`; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => { const [t, key] = k.split('|'); return { t, key, n }; });
  }, [bComments]);
  const threadLabel = (t: string, key: string) => t === 'brand' ? 'Brand' : t === 'insights' ? 'Insights'
    : t === 'kpi' ? `KPI · ${DISC_KPIS.find(x => x.id === key)?.label ?? key}`
    : t === 'program' ? `Program · ${monthLabel(key)}`
    : t === 'week' ? `Week · ${dRange(key)}`
    : `Creator · ${brandCreators.find(c => c.id === key)?.name ?? key}`;

  return (
    <div className="pc-drawer-overlay" onClick={onClose}>
      <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="pc-drawer-head">
          <div className="pc-drawer-head-l">
            <span className="pc-ava" style={{ background: getGradient(brand.name), width: 40, height: 40, fontSize: 18, borderRadius: 12 }}>{(brand.name[0] || '?').toUpperCase()}</span>
            <div>
              <div className="pc-drawer-title">{brand.name}</div>
              <div className="pc-drawer-sub">Discussion</div>
            </div>
          </div>
          <button className="pc-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pc-drawer-body">
          <div className="pc-rd-weeks" style={{ marginBottom: 10 }}>
            {DISC_TYPES.map(t => (
              <button key={t.id} className={`pc-rd-week ${tt === t.id ? 'active' : ''}`} onClick={() => pickType(t.id)}>{t.label}</button>
            ))}
          </div>
          {needsKey && (
            <select className="pcc-input" style={{ marginBottom: 10 }} value={tk} onChange={e => setTk(e.target.value)}>
              <option value="">Select…</option>
              {keyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {(!needsKey || tk) ? (
            <PaidCollabComments
              comments={bComments} targetType={tt as any} targetKey={tk} title={title}
              mode={mode} currentAuthorName={currentName} defaultPublicName={publicName}
              onAdd={(body, name, parentId) => onAdd(tt, tk, body, name, parentId)}
              highlightCommentId={initial.highlight} defaultOpen
            />
          ) : <div className="pcc-empty" style={{ padding: 12 }}>Pick a {tt} to view its discussion.</div>}

          {threads.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 8 }}>All threads</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {threads.map(th => (
                  <button key={`${th.t}|${th.key}`} className="pc-cd-thread" onClick={() => { setTt(th.t); setTk(th.key); }}>
                    <span>{threadLabel(th.t, th.key)}</span><span className="pcc-count">{th.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
