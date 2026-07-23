import { useEffect, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../auth/AuthContext';
import ContentBriefView from './ContentBriefView';

/* ════════════════════════════════════════════════════════════
   /content-brief — Super Boss entry point to the AI Content Brief.

   Handlers reach the same <ContentBriefView> as a tab inside their
   /paid-collab workspace (gated on profiles.ai_brief_enabled). The handler
   workspace itself is role-gated to paid_collab_client / paid_collab_handler,
   so rather than open that whole surface to Bob, the Super Boss gets this
   thin standalone page around the identical component.

   Difference vs the handler tab: brands are ALL paid-collab brands (Bob reads
   every brands row via RLS) instead of just the ones assigned to one handler.

   Route is roles={['bob']} and the page self-guards on is_superbob — the same
   belt-and-braces pattern as /bobs.
════════════════════════════════════════════════════════════ */

interface BrandLite { id: string; name: string; client?: string; }

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ContentBriefPage() {
  const { profile } = useAuth();
  const isSuperBoss = profile?.role === 'bob' && !!profile?.is_superbob;

  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [month, setMonth] = useState(thisMonthKey());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperBoss) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      // `scope` is a text[]; a brand is paid-collab-enabled when it contains
      // 'paid_creator' (the "Paid Collabs" checkbox on the Brands page).
      const { data, error } = await supabase
        .from('brands').select('id,name,client,scope').order('name');
      if (cancelled) return;
      if (error) { setErr(error.message); setLoading(false); return; }
      setBrands(((data ?? []) as any[])
        .filter(b => Array.isArray(b.scope) && b.scope.includes('paid_creator'))
        .map(b => ({ id: b.id, name: b.name, client: b.client })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isSuperBoss]);

  if (!isSuperBoss) {
    return <Alert variant="danger">Only the Super Boss can use the AI Content Brief here.</Alert>;
  }
  if (loading) {
    return <div className="text-center py-5"><Spinner animation="border" /></div>;
  }

  return (
    <>
      {err && <Alert variant="danger">{err}</Alert>}
      {!err && brands.length === 0 && (
        <Alert variant="warning">
          No paid-collab brands yet — tick <b>Paid Collabs</b> in a brand's scope on the Brands page.
        </Alert>
      )}
      {/* Month picker lives here; inside the handler workspace the tab inherits
          the workspace's own month navigation instead. */}
      <div className="d-flex justify-content-end mb-3">
        <label className="d-inline-flex align-items-center gap-2 small text-muted">
          Month
          <input type="month" className="form-control form-control-sm" style={{ width: 160 }}
            value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} />
        </label>
      </div>
      <ContentBriefView brands={brands} month={month} />
    </>
  );
}
