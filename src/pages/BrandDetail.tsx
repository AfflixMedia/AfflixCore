import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Spinner, Alert, Nav, Badge, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import BrandResourcesTab from './brand/BrandResourcesTab';
import BrandReportingTab from './brand/BrandReportingTab';
import BrandGmvMaxTab from './brand/BrandGmvMaxTab';
import BrandSamplesTab from './brand/BrandSamplesTab';
import BrandPaidCollabTab from './brand/BrandPaidCollabTab';
import BrandProductsTab from './brand/BrandProductsTab';
import BrandBillingTab from './brand/BrandBillingTab';
import PaymentControlsTab from '../components/paidcollab/PaymentControlsTab';

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  share_enabled: boolean;
  client_status: string | null;
}

type TabKey = 'resources' | 'reporting' | 'gmv-max' | 'samples' | 'paid-collab' | 'products' | 'billing' | 'payments';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'resources',   label: 'Resources',      icon: 'bi-folder2-open' },
  { key: 'reporting',   label: 'Reporting',      icon: 'bi-bar-chart' },
  { key: 'gmv-max',     label: 'GMV Max',        icon: 'bi-graph-up-arrow' },
  { key: 'samples',     label: 'Sample Seeding', icon: 'bi-box-seam' },
  { key: 'products',    label: 'Products',       icon: 'bi-tags' },
  { key: 'paid-collab', label: 'Paid Collab',    icon: 'bi-people' },
  { key: 'payments',    label: 'Payments',       icon: 'bi-cash-stack' },
  { key: 'billing',     label: 'Billing',        icon: 'bi-cash-coin' },
];

export default function BrandDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApc = profile?.role === 'apc';
  const canManageGmvMax = !!profile?.can_manage_gmv_max;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [assignedToMe, setAssignedToMe] = useState(false);
  // Sibling list so we can offer prev / next navigation.
  const [siblingIds, setSiblingIds] = useState<string[]>([]);

  const tabFromUrl = (params.get('tab') as TabKey) || 'resources';

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const [{ data: b, error: bErr }, { data: assigns }, { data: siblings }] = await Promise.all([
        supabase.from('brands').select('id,name,client,client_id,share_enabled,client_status').eq('id', id).maybeSingle(),
        isApc
          ? supabase.from('apc_brands').select('brand_id').eq('apc_id', profile?.id ?? '').eq('brand_id', id ?? '')
          : Promise.resolve({ data: [] }),
        // RLS already scopes this to brands the user can see (Bob sees all,
        // APC sees their assigned brands).
        supabase.from('brands').select('id').order('name'),
      ]);
      if (bErr) { setErr(bErr.message); setLoading(false); return; }
      if (!b) { setErr('Brand not found.'); setLoading(false); return; }
      setBrand(b as Brand);
      setAssignedToMe(((assigns as any[])?.length ?? 0) > 0);
      setSiblingIds(((siblings as any[]) ?? []).map(x => x.id));
      setLoading(false);
    })();
  }, [id, isApc, profile?.id]);

  // Compute prev / next neighbour in the alphabetical list.
  const { prevId, nextId, currentIdx, totalSiblings } = useMemo(() => {
    if (!id || siblingIds.length === 0) {
      return { prevId: null as string | null, nextId: null as string | null, currentIdx: -1, totalSiblings: 0 };
    }
    const idx = siblingIds.indexOf(id);
    return {
      prevId: idx > 0 ? siblingIds[idx - 1] : null,
      nextId: idx >= 0 && idx < siblingIds.length - 1 ? siblingIds[idx + 1] : null,
      currentIdx: idx,
      totalSiblings: siblingIds.length,
    };
  }, [id, siblingIds]);

  const visibleTabs = useMemo(() => {
    if (isBob) return TABS;
    if (!isApc || !assignedToMe) return [];
    return TABS.filter(t => {
      if (t.key === 'gmv-max') return canManageGmvMax;
      if (t.key === 'billing') return false; // Bob-only financial data
      if (t.key === 'payments') return false; // Bob-only payment-popup controls
      return true;
    });
  }, [isBob, isApc, assignedToMe, canManageGmvMax]);

  const currentTab: TabKey = useMemo(() => {
    const fromUrl = visibleTabs.find(t => t.key === tabFromUrl);
    if (fromUrl) return fromUrl.key;
    return visibleTabs[0]?.key ?? 'resources';
  }, [visibleTabs, tabFromUrl]);

  const setTab = (k: TabKey) => {
    params.set('tab', k);
    setParams(params, { replace: true });
  };

  const onShareEnabledChanged = (next: boolean) =>
    setBrand(b => b ? { ...b, share_enabled: next } : b);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand) return null;

  if (visibleTabs.length === 0) {
    return (
      <Alert variant="warning">
        You don't have access to this brand's detail page. Ask Bob to assign you to it or grant the relevant permission.
      </Alert>
    );
  }

  // Brand is editable unless it is 'closed'. Onboarding / in-progress /
  // temporarily-paused all count as active/editable.
  const brandActive = brand.client_status !== 'closed';
  // Compose per-tab "can edit" flags by AND-ing role-based perms with brand active.
  const canEditResources = (isBob) && brandActive;
  const canEditGmvMax    = (isBob || canManageGmvMax) && brandActive;
  const canEditSamples   = (isBob || (isApc && assignedToMe)) && brandActive;
  const canEditPaidCollab = (isBob || (isApc && assignedToMe)) && brandActive;
  const canEditProducts   = (isBob || (isApc && assignedToMe)) && brandActive;
  // Reporting share toggles are Bob-only and require active brand.
  const canEditReporting = isBob && brandActive;

  return (
    <div className="ac-themed">
      <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => nav('/brands')} title="Back to brands">
            <i className="bi bi-arrow-left" />
          </Button>
          <div>
            <h2 className="mb-0">{brand.name}</h2>
            <div className="text-muted small">
              {brand.client}
              {!brandActive && (
                <Badge bg="dark" className="ms-2"><i className="bi bi-archive me-1" />Inactive</Badge>
              )}
              {brand.share_enabled
                ? <Badge bg="success" className="ms-2"><i className="bi bi-globe me-1" />Sharing on</Badge>
                : <Badge bg="secondary" className="ms-2"><i className="bi bi-lock me-1" />Sharing off</Badge>}
            </div>
          </div>
        </div>

        {/* Prev / next brand navigation — keeps the current tab so you can
            walk through brands without losing context. */}
        {totalSiblings > 1 && (
          <div className="d-flex align-items-center gap-2">
            <Button
              size="sm" variant="outline-secondary"
              disabled={!prevId}
              onClick={() => prevId && nav(`/brands/${prevId}?tab=${currentTab}`)}
              title="Previous brand">
              <i className="bi bi-chevron-left" /> Prev
            </Button>
            <span className="text-muted small" style={{ minWidth: 60, textAlign: 'center' }}>
              {currentIdx + 1} / {totalSiblings}
            </span>
            <Button
              size="sm" variant="outline-secondary"
              disabled={!nextId}
              onClick={() => nextId && nav(`/brands/${nextId}?tab=${currentTab}`)}
              title="Next brand">
              Next <i className="bi bi-chevron-right" />
            </Button>
          </div>
        )}
      </div>

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>This brand is inactive.</strong>{' '}
            All data is read-only — reports, sample seeding, paid collab, GMV Max and resources can't be edited until the brand is reactivated from the Brands list.
          </div>
        </Alert>
      )}

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Nav variant="tabs" activeKey={currentTab} onSelect={(k) => k && setTab(k as TabKey)}>
            {visibleTabs.map(t => (
              <Nav.Item key={t.key}>
                <Nav.Link eventKey={t.key}>
                  <i className={`bi ${t.icon} me-1`} />{t.label}
                </Nav.Link>
              </Nav.Item>
            ))}
          </Nav>
        </Card.Body>
      </Card>

      {currentTab === 'resources'   && <BrandResourcesTab brandId={brand.id} brandName={brand.name} canEdit={canEditResources} />}
      {currentTab === 'reporting'   && <BrandReportingTab brand={brand} isBob={isBob} canEdit={canEditReporting} onShareEnabledChanged={onShareEnabledChanged} />}
      {currentTab === 'gmv-max'     && <BrandGmvMaxTab brandId={brand.id} canEdit={canEditGmvMax} />}
      {currentTab === 'samples'     && <BrandSamplesTab brandId={brand.id} canEdit={canEditSamples} />}
      {currentTab === 'products'    && <BrandProductsTab brandId={brand.id} canEdit={canEditProducts} />}
      {currentTab === 'paid-collab' && <BrandPaidCollabTab brandId={brand.id} brandName={brand.name} canEdit={canEditPaidCollab} />}
      {currentTab === 'payments'    && <PaymentControlsTab brandId={brand.id} brandName={brand.name} canEdit={isBob && brandActive} />}
      {currentTab === 'billing'     && <BrandBillingTab brandId={brand.id} />}
    </div>
  );
}
