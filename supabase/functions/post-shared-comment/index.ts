// Supabase Edge Function: post-shared-comment
// Public — validates a share token, confirms the report belongs to the link,
// and inserts a client comment.
// Deploy in dashboard (Edge Functions → Deploy → "post-shared-comment")

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SECTIONS = ['overall','top_creators','top_videos','video_performance','gmv_max','product_highlights','shop_health','insights'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { token, report_id, section, author_name, body } = await req.json();
    if (!token || !report_id || !section || !author_name || !body) {
      return json({ error: 'token, report_id, section, author_name, body required' }, 400);
    }
    if (!SECTIONS.includes(section)) return json({ error: 'Invalid section' }, 400);
    if (String(body).trim().length === 0) return json({ error: 'Empty comment' }, 400);

    const { data: link } = await admin.from('report_share_links')
      .select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const { data: report } = await admin.from('weekly_reports')
      .select('id,brand_id').eq('id', report_id).maybeSingle();
    if (!report) return json({ error: 'Report not found' }, 404);
    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(report.brand_id)) return json({ error: 'Not allowed' }, 403);

    const { data: inserted, error } = await admin.from('report_comments').insert({
      report_id,
      section,
      author_type: 'client',
      author_name: String(author_name).trim().slice(0, 80),
      body: String(body).trim().slice(0, 4000),
    }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ comment: inserted });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
