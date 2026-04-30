import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, Spinner, Alert, Nav, Badge, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import BrandResourcesTab from './brand/BrandResourcesTab';
import BrandReportingTab from './brand/BrandReportingTab';
import BrandGmvMaxTab from './brand/BrandGmvMaxTab';
import BrandPaidCollabTab from './brand/BrandPaidCollabTab';

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  share_enabled: boolean;
}

type TabKey = 'resources' | 'reporting' | 'gmv-max' | 'paid-collab';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'resources',   label: 'Resources',   icon: 'bi-folder2-open' },
  { key: 'reporting',   label: 'Reporting',   icon: 'bi-bar-chart' },
  { key: 'gmv-max',     label: 'GMV Max',     icon: 'bi-graph-up-arrow' },
  { key: 'paid-collab', label: 'Paid Collab', icon: 'bi-people' },
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

  const tabFromUrl = (params.get('tab') as TabKey) || 'resources';

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const [{ data: b, error: bErr }, { data: assigns }] = await Promise.all([
        supabase.from('brands').select('id,name,client,client_id,share_enabled').eq('id', id).maybeSingle(),
        isApc
          ? supabase.from('apc_brands').select('brand_id').eq('apc_id', profile?.id ?? '').eq('brand_id', id ?? '')
          : Promise.resolve({ data: [] }),
      ]);
      if (bErr) { setErr(bErr.message); setLoading(false); return; }
      if (!b) { setErr('Brand not found.'); setLoading(false); return; }
      setBrand(b as Brand);
      setAssignedToMe(((assigns as any[])?.length ?? 0) > 0);
      setLoading(false);
    })();
  }, [id, isApc, profile?.id]);

  const visibleTabs = useMemo(() => {
    if (isBob) return TABS;
    if (!isApc || !assignedToMe) return [];
    return TABS.filter(t => {
      if (t.key === 'gmv-max') return canManageGmvMax;
      if (t.key === 'paid-collab') return false;
      // resources + reporting visible if APC is assigned
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
              {brand.share_enabled
                ? <Badge bg="success" className="ms-2"><i className="bi bi-globe me-1" />Sharing on</Badge>
                : <Badge bg="secondary" className="ms-2"><i className="bi bi-lock me-1" />Sharing off</Badge>}
            </div>
          </div>
        </div>
      </div>

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

      {currentTab === 'resources'   && <BrandResourcesTab brandId={brand.id} brandName={brand.name} />}
      {currentTab === 'reporting'   && <BrandReportingTab brand={brand} isBob={isBob} onShareEnabledChanged={onShareEnabledChanged} />}
      {currentTab === 'gmv-max'     && <BrandGmvMaxTab brandId={brand.id} canEdit={isBob || canManageGmvMax} />}
      {currentTab === 'paid-collab' && <BrandPaidCollabTab />}
    </div>
  );
}
