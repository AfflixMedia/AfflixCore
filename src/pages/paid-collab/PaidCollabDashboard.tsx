import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { useAuth } from '../../auth/AuthContext';
import { PerformanceReport, isPendingVisible } from './handlerCollabReadonly';
import {
  useClientWorkspaceData, BrandSwitch, ProgramsView, DiscussionsView, BrandLite,
} from './clientWorkspace';
import PaidCollabDiscussionDrawer from '../../components/paidcollab/PaidCollabDiscussionDrawer';
import './dashboard.css';

type Tab = 'performance' | 'programs' | 'discussions';

export default function PaidCollabDashboard() {
  const { profile } = useAuth();
  const { brands, creators, months, comments, loading, err, confirmPaid, addComment } = useClientWorkspaceData();

  const [tab, setTab] = useState<Tab>('performance');
  const [brandSel, setBrandSel] = useState<string>('all');
  const [openProgram, setOpenProgram] = useState<{ brandId: string; month: string } | null>(null);
  const [disc, setDisc] = useState<{ brandId: string; tt: string; tk: string; highlight?: string } | null>(null);
  const [seenAt, setSeenAt] = useState(() => Number(localStorage.getItem('ac_pcc_dash_seen') || 0));

  // ── Notification deep-link (mirrors the handler workspace) ──
  //  /paid-collab?brand=&tt=&tk=&pcc=   → open the discussion thread drawer
  //  /paid-collab?brand=&pay=1[&month=] → open the program detail (pending row visible)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (loading || deepLinked.current || brands.length === 0) return;
    deepLinked.current = true;
    const sp = new URLSearchParams(window.location.search);
    const b = sp.get('brand');
    if (!b || !brands.some(x => x.id === b)) return;
    setBrandSel(b);
    if (sp.get('pay') === '1') {
      const m = sp.get('month');
      const month = m && /^\d{4}-\d{2}$/.test(m) ? m : (months.find(x => x.brand_id === b)?.month || '');
      setTab('programs');
      if (month) setOpenProgram({ brandId: b, month });
    } else if (sp.get('tt')) {
      setTab('discussions');
      setDisc({ brandId: b, tt: sp.get('tt') || 'brand', tk: sp.get('tk') || '', highlight: sp.get('pcc') || undefined });
    }
  }, [loading, brands, months]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const firstName = useMemo(() => {
    const n = profile?.full_name || profile?.email || '';
    return n.split(' ')[0]?.split('@')[0] || 'there';
  }, [profile]);
  const currentName = profile?.full_name || profile?.email || 'Client';

  const brandById = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands]);
  const creatorById = useMemo(() => new Map(creators.map(c => [c.id, c])), [creators]);

  const inScope = (brandId: string) => brandSel === 'all' || brandId === brandSel;
  const scopedCreators = useMemo(() => creators.filter(c => inScope(c.brand_id)), [creators, brandSel]);
  const scopedMonths = useMemo(() => months.filter(m => inScope(m.brand_id)), [months, brandSel]);
  const scopedComments = useMemo(() => comments.filter(c => inScope(c.brand_id)), [comments, brandSel]);

  const selectedBrand: BrandLite = useMemo(() => {
    if (brandSel === 'all') return { id: 'all', name: brands.length === 1 ? brands[0].name : 'All brands', client: null };
    return brands.find(b => b.id === brandSel) || { id: 'all', name: 'All brands', client: null };
  }, [brandSel, brands]);
  const concreteBrand = useMemo<BrandLite | null>(() => {
    if (brandSel !== 'all') return brandById.get(brandSel) || null;
    return brands.length === 1 ? brands[0] : null;
  }, [brandSel, brands, brandById]);

  const newReplies = useMemo(
    () => comments.filter(c => c.author_type !== 'client' && new Date(c.created_at).getTime() > seenAt).length,
    [comments, seenAt],
  );
  // Payment-pending creators visible to the client (across all brands) → hero "action needed".
  const pendingCount = useMemo(() => creators.filter(c => isPendingVisible(c)).length, [creators]);

  const openDisc = (brandId: string, tt: string, tk: string, highlight?: string) => { setTab('discussions'); setDisc({ brandId, tt, tk, highlight }); };
  const closeDisc = () => {
    setDisc(null);
    const now = Date.now();
    localStorage.setItem('ac_pcc_dash_seen', String(now));
    setSeenAt(now);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div className="pcd">
      <div className="pcd-hero">
        <div className="pcd-hero-inner">
          <div>
            <div className="pcd-hero-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
            <h2 className="pcd-hero-title">{greeting}, {firstName}</h2>
            <div className="pcd-hero-sub">Your paid collab performance across {brands.length} brand{brands.length === 1 ? '' : 's'}.</div>
          </div>
          {pendingCount > 0 && (
            <button className="pcd-hero-cta"
              onClick={() => { setBrandSel('all'); setOpenProgram(null); setTab('programs'); }}
              style={{ border: 'none', cursor: 'pointer', textAlign: 'left' }} title="View payment-pending creators">
              <span className="pcd-hero-cta-ico"><i className="bi bi-cash-stack" /></span>
              <div>
                <div className="pcd-hero-cta-big">{pendingCount} payment{pendingCount === 1 ? '' : 's'} pending</div>
                <div className="pcd-hero-cta-small">Action needed</div>
              </div>
            </button>
          )}
        </div>
      </div>

      {brands.length === 0 ? (
        <Alert variant="light" className="border text-center py-5">
          <i className="bi bi-shop fs-1 d-block mb-2 opacity-50" />
          <h5 className="mb-1">No brands yet</h5>
          <p className="text-muted mb-0 small">Once paid collab brands are assigned to you, your performance report shows up here.</p>
        </Alert>
      ) : (
        <>
          <BrandSwitch brands={brands} value={brandSel} onChange={v => { setBrandSel(v); setOpenProgram(null); }} />

          <div className="pc-app" style={{ minHeight: 0, background: 'transparent', padding: 0 }}>
            <div className="pc-tabs" style={{ marginBottom: 16 }}>
              <button className={`pc-tab ${tab === 'performance' ? 'active' : ''}`} onClick={() => setTab('performance')}>Performance</button>
              <button className={`pc-tab ${tab === 'programs' ? 'active' : ''}`} onClick={() => setTab('programs')}>Programs</button>
              <button className={`pc-tab ${tab === 'discussions' ? 'active' : ''}`} onClick={() => setTab('discussions')}>
                Discussions{newReplies > 0 && <span className="pc-tab-badge">{newReplies}</span>}
              </button>
            </div>

            {tab === 'performance' && (
              <PerformanceReport
                brand={selectedBrand} creators={scopedCreators}
                onDiscuss={concreteBrand ? (tt, tk) => openDisc(concreteBrand.id, tt, tk) : undefined}
              />
            )}
            {tab === 'programs' && (
              <ProgramsView
                months={scopedMonths} creators={scopedCreators} brandById={brandById}
                showBrand={brandSel === 'all'} openProgram={openProgram} setOpenProgram={setOpenProgram}
                onConfirmPaid={confirmPaid} onDiscuss={openDisc}
              />
            )}
            {tab === 'discussions' && (
              <DiscussionsView
                comments={scopedComments} brandById={brandById} creatorById={creatorById}
                seenAt={seenAt} showBrand={brandSel === 'all'} concreteBrand={concreteBrand} onOpen={openDisc}
              />
            )}
          </div>
        </>
      )}

      {disc && (
        <PaidCollabDiscussionDrawer
          brand={brandById.get(disc.brandId) || { id: disc.brandId, name: '' }}
          comments={comments} creators={creators} months={months}
          mode="authed" currentName={currentName}
          initial={{ tt: disc.tt, tk: disc.tk, highlight: disc.highlight }}
          onAdd={(tt, tk, body, _name, parentId) => addComment(disc.brandId, tt, tk, body, parentId)}
          onClose={closeDisc}
        />
      )}
    </div>
  );
}
