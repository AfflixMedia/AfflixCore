import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { PaidProgram, PaidCreator, PaidVideo, PaidCreatorPerformance } from '../../lib/paidCollabSchema';

export interface Brand {
  id: string;
  name: string;
  client: string;
  client_status: string | null;
  currency?: string | null;
  payment_popup_default?: any;
}

// Role-aware "is this creator's Payment Pending shown" check. The client only sees a
// creator's pending status once the handler toggles pending_visible_to_client on; the
// handler (revealAll) sees every pending. Mirrors handlerCollabReadonly.clientStatus.
export const isPaidCollabPendingVisible = (c: any, revealAll = false) =>
  c?.payment_status === 'pending' && (revealAll || !!c?.pending_visible_to_client);

export function useClientPaidCollabData() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [performance, setPerformance] = useState<PaidCreatorPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      
      // Brands now come from public.brands: paid-collab-enabled (scope 'paid_creator')
      // and RLS-scoped to those assigned to this client via paid_collab_client_brands.
      const { data: bRows, error: bErr } = await supabase
        .from('brands').select('id,name,client,currency').contains('scope', ['paid_creator']).order('name');
      if (bErr) { setErr(bErr.message); setLoading(false); return; }

      const bs = (bRows || []).map(b => ({
        id: b.id,
        name: b.name,
        client: b.client,
        client_status: null,
        currency: (b as any).currency ?? 'USD',
      }));
      setBrands(bs);
      if (bs.length === 0) { setLoading(false); return; }
      // Each synthesized "program" (brand-month) inherits the brand's region currency.
      const brandCurrency = new Map(bs.map(b => [b.id, b.currency || 'USD']));

      const { data: pRows, error: pErr } = await supabase
        .from('handler_collab_brand_months').select('*').in('brand_id', bs.map(b => b.id));
      if (pErr) { setErr(pErr.message); setLoading(false); return; }

      const progs = (pRows || []).map(p => ({
        id: p.id,
        brand_id: p.brand_id,
        name: `Month ${p.month}`,
        currency: brandCurrency.get(p.brand_id) || 'USD',
        total_budget: p.budget,
        ended_at: null,
      } as unknown as PaidProgram));
      setPrograms(progs);
      if (progs.length === 0) { setCreators([]); setVideos([]); setLoading(false); return; }

      const { data: cRowsRaw, error: cErr } = await supabase
        .from('handler_collab_creators').select('*').in('brand_id', bs.map(b => b.id));
      if (cErr) { setErr(cErr.message); setLoading(false); return; }
      // Terminated deals are internal-only — never shown to the client.
      const cRows = (cRowsRaw || []).filter(c => c.payment_status !== 'terminated');

      // Contract e-signatures — read views link to the signed copy at /sign/<token>.
      const { data: sigRows } = await supabase
        .from('handler_contract_signatures')
        .select('creator_id, token, signed_at, signer_name')
        .in('brand_id', bs.map(b => b.id));
      const sigByCreator = new Map((sigRows || []).map((s: any) => [s.creator_id, s]));

      const cs = (cRows || []).map(c => {
        const monthKey = c.onboarded_on ? c.onboarded_on.substring(0, 7) : null;
        let progId = progs.find(p => p.brand_id === c.brand_id && p.name === `Month ${monthKey}`)?.id;
        if (!progId) {
          progId = progs.find(p => p.brand_id === c.brand_id)?.id || 'unknown';
        }
        return {
          id: c.id,
          program_id: progId,
          name: c.name,
          handle: c.tiktok_handle,
          fee: c.amount,
          agreed_videos: c.videos_count,
          status: 'active',
          paid_out: c.payment_status === 'paid',
          created_at: c.created_at,
          // Raw passthrough for the read-only expand panel (video links + ad codes,
          // payout / payment link). These come straight from handler_collab_creators.
          video_codes: Array.isArray(c.video_codes) ? c.video_codes : [],
          paypal: c.paypal || '',
          zelle: c.zelle || '',
          payment_status: c.payment_status,
          // The handler keeps "Payment Pending" hidden from the client until they
          // flip this on — so the client only ever sees a pending status when true.
          pending_visible_to_client: !!c.pending_visible_to_client,
          completed_on: c.completed_on || null,
          onboard_date: c.onboarded_on || null,
          // Signed contract — the creator's e-signature (else the legacy pasted
          // link) — shown to everyone with brand access.
          contract_url: c.contract_url || null,
          signed_contract: sigByCreator.get(c.id) || null,
          // Client "marked payment as done" soft flag (set via set_client_paidcollab_paid).
          client_paid_confirmed_at: c.client_paid_confirmed_at || null,
          client_paid_confirmed_name: c.client_paid_confirmed_name || null,
        } as unknown as PaidCreator;
      });
      setCreators(cs);

      const vids: PaidVideo[] = [];
      const perfs: PaidCreatorPerformance[] = [];
      
      (cRows || []).forEach(c => {
        if (Array.isArray(c.video_codes)) {
          c.video_codes.forEach((v: any, idx: number) => {
            if (v && v.video && v.video.trim() !== '') {
              vids.push({
                id: `${c.id}-vid-${idx}`,
                creator_id: c.id,
                tiktok_url: v.video,
                ad_code: v.adCode || null,
                ad_code_authorized: !!v.auth,
                posted_on: c.completed_on || c.onboarded_on || c.created_at,
                status: 'live',
                created_at: c.created_at
              } as unknown as PaidVideo);
            }
          });
        }
        
        if (c.monthly && typeof c.monthly === 'object') {
          Object.keys(c.monthly).forEach(mKey => {
            const mData = c.monthly[mKey];
            if (mData.gmv) {
              perfs.push({
                id: `${c.id}-perf-${mKey}`,
                creator_id: c.id,
                period_type: 'weekly',
                gmv: mData.gmv,
                items_sold: 0,
                created_at: c.created_at
              } as unknown as PaidCreatorPerformance);
            }
          });
        }
      });
      
      setVideos(vids);
      setPerformance(perfs);
      setLoading(false);
    })();
  }, []);

  return { brands, programs, creators, videos, performance, loading, err };
}
