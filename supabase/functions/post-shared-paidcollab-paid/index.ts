// Supabase Edge Function: post-shared-paidcollab-paid
// Public — validates a share token, confirms the creator's brand belongs to the
// link, and flips the client's "marked as paid" confirmation on a paid-collab
// creator deal (handler_collab_creators.client_paid_confirmed_at).
//
// This DOES NOT change payment_status. It is a soft confirmation by the client
// that they processed the PayPal payment. On confirm, the brand's assigned
// handler(s) + Bob get a notification so they can cross-check and finalize the
// real status from the backend.
//
// Deploy: supabase functions deploy post-shared-paidcollab-paid

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

    const reqBody = await req.json();
    const { token, brand_id, creator_id } = reqBody;
    const confirmed = reqBody.confirmed !== false; // default true
    const author_name = reqBody.author_name;
    if (!token || !brand_id || !creator_id) {
      return json({ error: 'token, brand_id, creator_id required' }, 400);
    }

    const { data: link } = await admin.from('report_share_links').select('*').eq('token', token).maybeSingle();
    if (!link) return json({ error: 'Invalid link' }, 404);
    if (link.revoked_at) return json({ error: 'Link revoked' }, 410);

    const brandIds: string[] = link.brand_ids ?? [];
    if (!brandIds.includes(brand_id)) return json({ error: 'Not allowed' }, 403);

    // Confirm the creator belongs to this brand.
    const { data: cr } = await admin.from('handler_collab_creators')
      .select('id,brand_id,name,onboarded_on,payment_status,pending_visible_to_client').eq('id', creator_id).maybeSingle();
    if (!cr || cr.brand_id !== brand_id) return json({ error: 'Invalid creator' }, 400);
    // Defense in depth: only a genuinely client-visible pending payout can be
    // confirmed. The UI already gates this (clientStatus masking), but never
    // trust the client — reject a crafted request against a masked/paid creator.
    if (confirmed && !(cr.payment_status === 'pending' && cr.pending_visible_to_client === true)) {
      return json({ error: 'This payout is not open for confirmation' }, 409);
    }

    const cleanName = String(author_name ?? '').trim().slice(0, 80) || 'Client';

    const { data: updated, error } = await admin.from('handler_collab_creators')
      .update({
        client_paid_confirmed_at: confirmed ? new Date().toISOString() : null,
        client_paid_confirmed_name: confirmed ? cleanName : null,
      })
      .eq('id', creator_id)
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);

    // On confirm, notify the brand's assigned handler(s) + Bob so they can verify.
    if (confirmed) {
      try {
        // Notify ONLY the brand's assigned paid-collab handler(s) — paid collab is
        // the handler's domain (same convention as post-shared-paidcollab-comment).
        // Not Bob, not APC.
        const [{ data: brand }, { data: handlerRows }] = await Promise.all([
          admin.from('brands').select('id,name').eq('id', brand_id).single(),
          admin.from('paid_collab_handler_brands').select('handler_id').eq('brand_id', brand_id),
        ]);
        const recipientIds = new Set<string>();
        (handlerRows ?? []).forEach((r: any) => recipientIds.add(r.handler_id));

        const title = `${cleanName} marked a payment as done (Paid Collab)`;
        const bodyText = `${cleanName} confirmed paying ${cr.name || 'a creator'} on ${brand?.name ?? 'a brand'}. Please cross-check and update the status.`;
        // `pay=1` opens the brand's workspace drilldown (not the discussion drawer);
        // `month` jumps to the creator's program month so the pending row is visible.
        const month = cr.onboarded_on ? String(cr.onboarded_on).slice(0, 7) : '';
        const linkUrl = `/paid-collab?brand=${encodeURIComponent(brand_id)}&pay=1${month ? `&month=${month}` : ''}`;
        const payload = { brand_id, creator_id, kind: 'client_marked_paid' };
        const rows = Array.from(recipientIds).map(uid => ({
          user_id: uid, type: 'paid_collab_client_paid', title, body: bodyText, link: linkUrl, payload,
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
    }

    return json({ creator: updated });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
