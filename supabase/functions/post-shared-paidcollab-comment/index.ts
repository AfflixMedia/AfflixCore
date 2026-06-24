// Supabase Edge Function: post-shared-paidcollab-comment
// Public — validates a share token, confirms the brand belongs to the link, and
// inserts a CLIENT comment on paid-collab data (brand/program/week/creator/insights/kpi).
// Then notifies the brand's assigned handler(s) + Bob with a click-through link.
// Deploy: supabase functions deploy post-shared-paidcollab-comment

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TARGET_TYPES = ['brand', 'program', 'week', 'creator', 'insights', 'kpi'];
const TYPE_LABEL: Record<string, string> = {
  brand: 'Brand', program: 'Program', week: 'Week', creator: 'Creator', insights: 'Insights', kpi: 'KPI',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const reqBody = await req.json();
    const { token, brand_id, target_type, author_name, body, parent_id } = reqBody;
    const target_key = String(reqBody.target_key ?? '');
    if (!token || !brand_id || !target_type || !author_name || !body) {
      return json({ error: 'token, brand_id, target_type, author_name, body required' }, 400);
    }
    if (!TARGET_TYPES.includes(target_type)) return json({ error: 'Invalid target_type' }, 400);
    if (String(body).trim().length === 0) return json({ error: 'Empty comment' }, 400);

    const { data: link } = await admin.from('report_share_links').select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(brand_id)) return json({ error: 'Not allowed' }, 403);

    // Creator threads must reference a creator that belongs to this brand.
    if (target_type === 'creator') {
      const { data: cr } = await admin.from('handler_collab_creators')
        .select('id,brand_id').eq('id', target_key).maybeSingle();
      if (!cr || cr.brand_id !== brand_id) return json({ error: 'Invalid creator' }, 400);
    }

    if (parent_id) {
      const { data: parent } = await admin.from('paid_collab_comments')
        .select('brand_id,target_type,target_key').eq('id', parent_id).maybeSingle();
      if (!parent || parent.brand_id !== brand_id || parent.target_type !== target_type || parent.target_key !== target_key) {
        return json({ error: 'Invalid parent' }, 400);
      }
    }

    const cleanName = String(author_name).trim().slice(0, 80);
    const cleanBody = String(body).trim().slice(0, 4000);

    const { data: inserted, error } = await admin.from('paid_collab_comments').insert({
      brand_id,
      target_type,
      target_key,
      author_type: 'client',
      author_id: null,
      author_name: cleanName,
      body: cleanBody,
      parent_id: parent_id ?? null,
    }).select().single();
    if (error) return json({ error: error.message }, 500);

    // Notify ONLY the brand's assigned paid-collab handler(s) — not Bob, not APC.
    // Paid collab is the handler's domain, so the comment goes to the handler(s)
    // assigned to this brand via paid_collab_handler_brands.
    try {
      const [{ data: brand }, { data: handlerRows }] = await Promise.all([
        admin.from('brands').select('id,name').eq('id', brand_id).single(),
        admin.from('paid_collab_handler_brands').select('handler_id').eq('brand_id', brand_id),
      ]);
      const recipientIds = new Set<string>();
      (handlerRows ?? []).forEach((r: any) => recipientIds.add(r.handler_id));

      const title = `New comment on ${brand?.name ?? 'a brand'} (Paid Collab)`;
      const bodyText = `${cleanName} commented on ${TYPE_LABEL[target_type] || 'item'}: "${cleanBody.slice(0, 140)}${cleanBody.length > 140 ? '…' : ''}"`;
      const linkUrl = `/paid-collab?brand=${encodeURIComponent(brand_id)}&tt=${encodeURIComponent(target_type)}&tk=${encodeURIComponent(target_key)}&pcc=${(inserted as any).id}`;
      const payload = { brand_id, target_type, target_key, comment_id: (inserted as any).id };
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid, type: 'paid_collab_comment', title, body: bodyText, link: linkUrl, payload,
      }));
      if (rows.length > 0) await admin.from('notifications').insert(rows);

      const vapidConfigured = !!Deno.env.get('VAPID_PUBLIC_KEY');
      if (vapidConfigured && rows.length > 0) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
            body: JSON.stringify({ user_ids: Array.from(recipientIds), title, body: bodyText, link: linkUrl }),
          });
        } catch (_) { /* best effort */ }
      }
    } catch (notifyErr) {
      console.error('Notification dispatch failed:', notifyErr);
    }

    return json({ comment: inserted });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
