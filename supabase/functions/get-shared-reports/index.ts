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

    const linkMode: 'brand' | 'general' = link.link_mode === 'general' ? 'general' : 'brand';
    const brandIds: string[] = link.brand_ids ?? [];
    if (linkMode === 'brand' && brandIds.length === 0) {
      return json({ error: 'No brands assigned to this link' }, 400);
    }

    // General-mode links: no reports, only the explicitly-picked general resources.
    if (linkMode === 'general') {
      const explicitIds: string[] = link.resource_ids ?? [];
      if (explicitIds.length === 0) return json({ error: 'No resources assigned to this link' }, 400);

      const [{ data: client }, { data: rawResources }] = await Promise.all([
        admin.from('clients').select('id,name').eq('id', link.client_id).single(),
        admin.from('resources').select('*').in('id', explicitIds),
      ]);
      // Defense in depth: only general scope + still flagged is_shared
      const resources = (rawResources ?? []).filter((r: any) => r.scope === 'general' && r.is_shared);
      const sharedResourceIds = resources.map((r: any) => r.id);
      const { data: resource_comments } = sharedResourceIds.length > 0
        ? await admin.from('resource_comments').select('*').in('resource_id', sharedResourceIds).order('created_at', { ascending: true })
        : { data: [] };
      return json({
        client,
        brands: [],
        reports: [],
        resources,
        comments: [],
        resource_comments: resource_comments ?? [],
        label: link.label ?? null,
        include_reports: false,
        include_resources: true,
        link_mode: 'general',
      });
    }

    const includeReports   = link.include_reports   !== false;
    const includeResources = link.include_resources !== false;

    const [{ data: client }, { data: allBrands }, { data: rawReports }, { data: rawResources }] = await Promise.all([
      admin.from('clients').select('id,name').eq('id', link.client_id).single(),
      admin.from('brands').select('id,name,client,client_id,share_enabled').in('id', brandIds),
      includeReports
        ? admin.from('weekly_reports').select('*').in('brand_id', brandIds)
            .eq('is_shared', true)
            .order('week_start', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      includeResources
        ? admin.from('resources').select('*').eq('is_shared', true)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // Defense in depth: drop brands whose master share toggle is off (admin may have disabled it after the link was created).
    const brands = (allBrands ?? []).filter((b: any) => b.share_enabled === true)
      .map(({ share_enabled: _share, ...rest }: any) => rest);
    const allowedBrandIds = new Set(brands.map((b: any) => b.id));
    const reports = (rawReports ?? []).filter((r: any) => allowedBrandIds.has(r.brand_id));

    // Auto-include is_shared resources: general (always) + brand-scope where the brand is in the link AND share_enabled.
    const resources = (rawResources ?? []).filter((r: any) =>
      r.scope === 'general' || (r.brand_id && allowedBrandIds.has(r.brand_id))
    );

    const reportIds = reports.map((r: any) => r.id);
    const { data: comments } = reportIds.length > 0
      ? await admin.from('report_comments').select('*').in('report_id', reportIds).order('created_at', { ascending: true })
      : { data: [] };

    const sharedResourceIds = (resources ?? []).map((r: any) => r.id);
    const { data: resource_comments } = sharedResourceIds.length > 0
      ? await admin.from('resource_comments').select('*').in('resource_id', sharedResourceIds).order('created_at', { ascending: true })
      : { data: [] };

    return json({
      client,
      brands,
      reports,
      resources: resources ?? [],
      comments: comments ?? [],
      resource_comments: resource_comments ?? [],
      label: link.label ?? null,
      include_reports: includeReports,
      include_resources: includeResources,
      link_mode: 'brand',
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
