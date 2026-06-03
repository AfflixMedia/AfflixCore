// Supabase Edge Function: post-shared-program-comment
// Public — validates a share token and inserts a thread comment from the
// client on a paid creator program. Staff replies use the staff RLS policy
// on `paid_program_threads` directly.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { token, program_id, author_name, body: msgBody, parent_id, creator_id } = body;
    if (!token || !program_id || !author_name || !msgBody) {
      return json({ error: 'token, program_id, author_name, body required' }, 400);
    }

    const { data: link } = await admin.from('report_share_links')
      .select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);
    if (link.include_paid_collab !== true) {
      return json({ error: 'Paid Collab is not shared on this link' }, 403);
    }

    const { data: program } = await admin.from('paid_creator_programs')
      .select('id,brand_id').eq('id', program_id).maybeSingle();
    if (!program) return json({ error: 'Program not found' }, 404);

    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(program.brand_id)) return json({ error: 'Not allowed' }, 403);

    const { data: brand } = await admin.from('brands')
      .select('id,share_enabled').eq('id', program.brand_id).maybeSingle();
    if (!brand?.share_enabled) return json({ error: 'Sharing is disabled for this brand' }, 403);

    const cleanName = String(author_name).trim().slice(0, 80);
    const cleanBody = String(msgBody).trim().slice(0, 4000);
    if (!cleanName || !cleanBody) return json({ error: 'author_name and body must be non-empty' }, 400);

    // Optional creator-level thread — verify the creator belongs to this program.
    let creatorId: string | null = null;
    if (creator_id) {
      const { data: creatorRow } = await admin.from('paid_creators')
        .select('id,program_id').eq('id', creator_id).maybeSingle();
      if (!creatorRow || creatorRow.program_id !== program_id) {
        return json({ error: 'Creator not found in this program' }, 400);
      }
      creatorId = creator_id;
    }

    const { data: inserted, error } = await admin.from('paid_program_threads')
      .insert({
        program_id,
        creator_id: creatorId,
        share_link_id: link.id,
        author_type: 'client',
        author_name: cleanName,
        body: cleanBody,
        parent_id: parent_id ?? null,
      })
      .select().single();
    if (error) return json({ error: error.message }, 500);

    // Best-effort: notify staff (Bob + assigned APCs + handlers + paid collab clients).
    try {
      const [{ data: bobs }, { data: apcRows }, { data: handlerRows }, { data: clientRows }] = await Promise.all([
        admin.from('profiles').select('id').eq('role', 'bob'),
        admin.from('apc_brands').select('apc_id').eq('brand_id', program.brand_id),
        admin.from('paid_collab_handler_brands').select('handler_id').eq('brand_id', program.brand_id),
        admin.from('paid_collab_client_brands').select('client_id').eq('brand_id', program.brand_id),
      ]);
      const recipientIds = new Set<string>();
      (bobs ?? []).forEach((p: any) => recipientIds.add(p.id));
      (apcRows ?? []).forEach((r: any) => recipientIds.add(r.apc_id));
      (handlerRows ?? []).forEach((r: any) => recipientIds.add(r.handler_id));
      (clientRows ?? []).forEach((r: any) => recipientIds.add(r.client_id));
      const title = `${cleanName} commented on a paid collab program`;
      const bodyText = cleanBody.slice(0, 160) + (cleanBody.length > 160 ? '…' : '');
      const linkUrl = `/paid-collab/programs/${program_id}`;
      const rows = Array.from(recipientIds).map(uid => ({
        user_id: uid,
        type: 'paid_collab_thread_comment',
        title, body: bodyText, link: linkUrl,
        payload: { program_id, thread_comment_id: (inserted as any).id, brand_id: program.brand_id },
      }));
      if (rows.length > 0) await admin.from('notifications').insert(rows);
    } catch (notifyErr) {
      console.error('Notification dispatch failed:', notifyErr);
    }

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
