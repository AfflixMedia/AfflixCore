// Supabase Edge Function: get-shared-brief
//
// PUBLIC — resolves a content-brief share token into the brief itself, for the
// no-auth /brief/:token read view.
//
// The content_briefs table has no anon RLS policy on purpose: this function is
// the only public door, running under the service role and checking
// `share_enabled` itself. The token is the sole credential.
//
// Returns 404 for an unknown token and 410 when sharing has been switched off,
// so a revoked link says "no longer shared" instead of leaking existence.
//
// Deploy with JWT verification OFF (creators/clients open it signed out):
//   supabase functions deploy get-shared-brief --no-verify-jwt
// ‼️ Keep --no-verify-jwt on EVERY redeploy, same as chat-drive-media.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SIGN_TTL_SECONDS = 6 * 60 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function hmacHex(msg: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Brief images are stored as stable `drive:<fileId>` markers, never as signed
 * URLs (those expire in 6h and a shared brief would break overnight). We mint
 * fresh streaming URLs on every page load instead.
 *
 * Only ids that actually appear in THIS brief are signed, so the token grants
 * access to this brief's images and nothing else in the Drive folder.
 */
function collectDriveIds(...fields: (string | null)[]): string[] {
  const found = new Set<string>();
  for (const f of fields) {
    if (!f) continue;
    // Second form: the `https://afflix.invalid/brief-image#<id>` parking URL —
    // briefs imported before the FE normalised it back to `drive:` carry it.
    for (const m of f.matchAll(/(?:drive:|afflix\.invalid\/brief-image#)([\w-]{10,})/g)) found.add(m[1]);
  }
  return Array.from(found).slice(0, 50);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { token } = await req.json();
    if (!token || typeof token !== 'string') return json({ error: 'token required' }, 400);

    const { data: row, error } = await admin
      .from('content_briefs')
      // Explicit column list — never `*`. Keeps internal fields (inputs,
      // created_by, brand_id) off a public endpoint.
      .select('brand_name, title, body, logo_url, website_url, month, share_enabled, updated_at')
      .eq('share_token', token)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!row) return json({ error: 'This brief link is not valid.' }, 404);
    if (!row.share_enabled) {
      return json({ error: 'This brief is no longer shared.' }, 410);
    }

    // Mint fresh signed URLs for every Drive image this brief references.
    const ids = collectDriveIds(row.body, row.logo_url);
    const images: Record<string, string> = {};
    if (ids.length) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
      for (const id of ids) {
        const sig = await hmacHex(`${id}.${exp}`, serviceKey);
        images[id] = `${supabaseUrl}/functions/v1/chat-drive-media?id=${id}&exp=${exp}&sig=${sig}`;
      }
    }

    return json({
      brief: {
        brand_name: row.brand_name,
        title: row.title,
        body: row.body,
        logo_url: row.logo_url,
        website_url: row.website_url,
        month: row.month,
        updated_at: row.updated_at,
      },
      images,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
