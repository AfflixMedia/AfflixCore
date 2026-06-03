import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Button, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import PaidCollabTracker from '../../components/paidcollab/PaidCollabTracker';

interface Brand { id: string; name: string; client: string; client_status: string | null; }

/**
 * Public client portal — render the tracker for a single program.
 * The PaidCollabTracker takes care of all the program-level loading,
 * editing rules, and end-program flow; we just provide context (brand
 * header + back navigation) and the canEdit signal.
 */
export default function PaidCollabProgramView() {
  const { programId } = useParams<{ programId: string }>();
  const nav = useNavigate();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandLoading, setBrandLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setBrandLoading(true); setErr(null);
      // Resolve the program → brand for the header. RLS will block access
      // if the client isn't assigned to this brand.
      const { data: prog, error: pErr } = await supabase
        .from('paid_creator_programs').select('brand_id').eq('id', programId).maybeSingle();
      if (pErr) { setErr(pErr.message); setBrandLoading(false); return; }
      if (!prog) { setErr('Program not found or you do not have access.'); setBrandLoading(false); return; }
      const { data: b, error: bErr } = await supabase
        .from('brands').select('id,name,client,client_status')
        .eq('id', (prog as any).brand_id).maybeSingle();
      if (bErr) { setErr(bErr.message); setBrandLoading(false); return; }
      setBrand((b as Brand) ?? null);
      setBrandLoading(false);
    })();
  }, [programId]);

  if (brandLoading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand || !programId) return null;

  const brandActive = brand.client_status !== 'closed';

  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <Button size="sm" variant="outline-secondary" onClick={() => nav(-1)} title="Back">
          <i className="bi bi-arrow-left" />
        </Button>
        <div className="flex-grow-1 min-w-0">
          <div className="text-muted small">{brand.client}</div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <h4 className="mb-0">{brand.name}</h4>
            {!brandActive && (
              <Badge bg="dark"><i className="bi bi-archive me-1" />Inactive</Badge>
            )}
          </div>
        </div>
        <Button size="sm" variant="link" onClick={() => nav(`/paid-collab/brands/${brand.id}`)}>
          <i className="bi bi-list-ul me-1" />All {brand.name} programs
        </Button>
      </div>

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>This brand is currently inactive.</strong>{' '}
            The program data below is read-only.
          </div>
        </Alert>
      )}

      <PaidCollabTracker
        programId={programId}
        canEdit={brandActive}
        showBrand={false}
        onDeleted={() => nav(`/paid-collab/brands/${brand.id}`)}
      />
    </>
  );
}
