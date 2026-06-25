import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { useAuth } from '../../auth/AuthContext';
import { useClientWorkspaceData, BrandSwitch, ProgramsView } from './clientWorkspace';
import PaidCollabDiscussionDrawer from '../../components/paidcollab/PaidCollabDiscussionDrawer';
import './dashboard.css';

/**
 * Client sidebar "Programs" page — same brand-month Programs view as the dashboard's
 * Programs tab: payment-pending programs first, click into a program for the grouped
 * creator list with the "mark as paid" toggle + discussion drawer.
 */
export default function PaidCollabPrograms() {
  const { profile } = useAuth();
  const { brands, creators, months, comments, loading, err, confirmPaid, addComment } = useClientWorkspaceData();

  const [brandSel, setBrandSel] = useState<string>('all');
  const [openProgram, setOpenProgram] = useState<{ brandId: string; month: string } | null>(null);
  const [disc, setDisc] = useState<{ brandId: string; tt: string; tk: string; highlight?: string } | null>(null);

  const currentName = profile?.full_name || profile?.email || 'Client';
  const brandById = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands]);

  const inScope = (brandId: string) => brandSel === 'all' || brandId === brandSel;
  const scopedCreators = useMemo(() => creators.filter(c => inScope(c.brand_id)), [creators, brandSel]);
  const scopedMonths = useMemo(() => months.filter(m => inScope(m.brand_id)), [months, brandSel]);

  // Deep-link from a notification: /paid-collab/programs?brand=&month= (or ?pay=1)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (loading || deepLinked.current || brands.length === 0) return;
    deepLinked.current = true;
    const sp = new URLSearchParams(window.location.search);
    const b = sp.get('brand');
    if (!b || !brands.some(x => x.id === b)) return;
    setBrandSel(b);
    // Only auto-open a program when a month is explicitly given (e.g. a pay deep-link).
    // A plain ?brand= (from the Brands page) just filters the list to that brand.
    const m = sp.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) setOpenProgram({ brandId: b, month: m });
  }, [loading, brands, months]);

  const openDisc = (brandId: string, tt: string, tk: string, highlight?: string) => setDisc({ brandId, tt, tk, highlight });

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div className="pcd">
      <div className="ac-page-header">
        <h2 className="mb-0">Programs</h2>
      </div>

      {brands.length === 0 ? (
        <Alert variant="light" className="border text-center py-5">
          <i className="bi bi-rocket-takeoff fs-1 d-block mb-2 opacity-50" />
          <h5 className="mb-1">No programs yet</h5>
          <p className="text-muted mb-0 small">Once paid collab brands are assigned to you, their programs show up here.</p>
        </Alert>
      ) : (
        <>
          <BrandSwitch brands={brands} value={brandSel} onChange={v => { setBrandSel(v); setOpenProgram(null); }} />
          <div className="pc-app" style={{ minHeight: 0, background: 'transparent', padding: 0 }}>
            <ProgramsView
              months={scopedMonths} creators={scopedCreators} brandById={brandById}
              showBrand={brandSel === 'all'} openProgram={openProgram} setOpenProgram={setOpenProgram}
              onConfirmPaid={confirmPaid} onDiscuss={openDisc}
            />
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
          onClose={() => setDisc(null)}
        />
      )}
    </div>
  );
}
