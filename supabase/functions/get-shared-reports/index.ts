// Supabase Edge Function: get-shared-reports
// Public — no auth required. Validates a share token and returns brands + reports.
// Deploy in dashboard (Edge Functions → Deploy a new function → "get-shared-reports")

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? (await safeJson(req))?.token;
    if (!token) return json({ error: 'token required' }, 400);

    const { data: link, error: linkErr } = await admin
      .from('report_share_links')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (linkErr) return json({ error: linkErr.message }, 500);
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const brandIds: string[] = link.brand_ids ?? [];
    if (brandIds.length === 0) return json({ error: 'No brands assigned to this link' }, 400);

    const resourceIds: string[] = link.resource_ids ?? [];
    const [{ data: client }, { data: brands }, { data: reports }, { data: resources }] = await Promise.all([
      admin.from('clients').select('id,name').eq('id', link.client_id).single(),
      admin.from('brands').select('id,name,client,client_id').in('id', brandIds),
      admin.from('weekly_reports').select('*').in('brand_id', brandIds)
        .order('week_start', { ascending: false }),
      resourceIds.length > 0
        ? admin.from('resources').select('*').in('id', resourceIds)
        : Promise.resolve({ data: [] }),
    ]);

    return json({
      client,
      brands: brands ?? [],
      reports: reports ?? [],
      resources: resources ?? [],
      label: link.label ?? null,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

async function safeJson(req: Request) {
  try { return await req.json(); } catch { return null; }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
