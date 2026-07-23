// Supabase Edge Function: brief-drive-upload
//
// Brokers CONTENT BRIEF image uploads into Google Drive, mirroring
// chat-drive-upload. Brief images (uploaded logos, product shots, banner
// artwork) live on Drive exactly like chat attachments, not in Supabase
// Storage. Bytes never pass through this function:
//
//   action 'create'   → checks the caller has AI Content Brief access, opens a
//                       Drive RESUMABLE upload session (minted with the
//                       browser's Origin so the browser PUTs bytes straight to
//                       googleapis.com) and returns the session URL.
//   action 'finalize' → verifies the file landed in OUR brief folder and
//                       returns { drive_id, name, mime, size }. The file stays
//                       FULLY PRIVATE on Drive — no anyone-with-link permission.
//   action 'sign'     → mints short-lived HMAC-signed URLs pointing at the
//                       existing `chat-drive-media` streamer (same signing
//                       scheme, so no second streaming endpoint is needed).
//   action 'discard'  → deletes a Drive file that no brief references
//                       (cancelled upload / replaced pick).
//
// WHY IDs, NOT URLS, ARE STORED IN THE BRIEF:
// signed URLs expire after 6h. A brief keeps a stable `drive:<fileId>` marker
// in its Markdown and URLs are minted fresh on every render (in-app here, and
// for the public page inside get-shared-brief). Shared links therefore never
// rot.
//
// Secrets: GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN,
//          and GDRIVE_BRIEF_FOLDER_ID (falls back to GDRIVE_FOLDER_ID so this
//          works with the existing chat folder if no dedicated one is set).
//
// Deploy: supabase functions deploy brief-drive-upload

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;   // 25 MB, same as chat images
const SIGN_TTL_SECONDS = 6 * 60 * 60;       // 6h, same as chat media

let cachedToken: { token: string; expiresAt: number } | null = null;

async function driveAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GDRIVE_CLIENT_ID')!,
      client_secret: Deno.env.get('GDRIVE_CLIENT_SECRET')!,
      refresh_token: Deno.env.get('GDRIVE_REFRESH_TOKEN')!,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google auth failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

async function hmacHex(msg: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const folderId = Deno.env.get('GDRIVE_BRIEF_FOLDER_ID') || Deno.env.get('GDRIVE_FOLDER_ID');
    if (!folderId) return json({ error: 'Drive folder is not configured (GDRIVE_BRIEF_FOLDER_ID).' }, 500);

    // ── auth: signed in AND has brief access ──
    // Validate the caller's JWT explicitly against a service-role client, the
    // same way chat-drive-upload does. The previous approach — an anon client
    // with the Authorization header + getUser() with NO argument — reads the
    // session from (empty, server-side) storage instead of the header, so it
    // always came back "Not authenticated". (Chat worked; briefs didn't.)
    const admin = createClient(supabaseUrl, serviceKey);
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401);

    const { data: prof } = await admin
      .from('profiles').select('role, is_superbob, ai_brief_enabled')
      .eq('id', user.id).single();
    const allowed = !!prof && (
      (prof.role === 'paid_collab_handler' && prof.ai_brief_enabled === true)
      || (prof.role === 'bob' && prof.is_superbob === true)
    );
    if (!allowed) return json({ error: 'Forbidden — no AI Content Brief access.' }, 403);

    const body = await req.json();
    const action = String(body.action ?? '');

    // ── create: open a resumable session ──
    if (action === 'create') {
      const name = String(body.name ?? 'image').slice(0, 200);
      const mime = String(body.mime ?? '');
      const size = Number(body.size ?? 0);
      const origin = String(body.origin ?? '');

      // Images only. A brief is a web page; anything else has no place in it,
      // and this keeps the executable-file blocklist question moot.
      if (!mime.startsWith('image/')) {
        return json({ error: 'Only image files can be added to a brief.' }, 400);
      }
      if (!Number.isFinite(size) || size <= 0) return json({ error: 'Invalid file size' }, 400);
      if (size > MAX_IMAGE_BYTES) {
        return json({ error: `Image too large — max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.` }, 400);
      }

      const token = await driveAccessToken();
      const initHeaders: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      };
      if (origin) initHeaders['Origin'] = origin;

      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
        {
          method: 'POST',
          headers: initHeaders,
          body: JSON.stringify({ name, parents: [folderId], mimeType: mime }),
        },
      );
      if (!initRes.ok) {
        console.error('Drive session init failed:', initRes.status, await initRes.text());
        return json({ error: 'Could not start the Drive upload. Check the Drive configuration.' }, 502);
      }
      const uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) return json({ error: 'Drive did not return an upload session' }, 502);
      return json({ upload_url: uploadUrl });
    }

    // ── finalize: confirm it landed in our folder ──
    if (action === 'finalize') {
      const fileId = String(body.file_id ?? '');
      if (!/^[\w-]{10,}$/.test(fileId)) return json({ error: 'Invalid file id' }, 400);

      const token = await driveAccessToken();
      const meta = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,parents&supportsAllDrives=true`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      if (!meta.ok) return json({ error: 'Uploaded file not found on Drive' }, 404);
      const file = await meta.json();
      // Only files in OUR brief folder are usable — stops a caller from
      // signing arbitrary files belonging to the company account.
      if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) {
        return json({ error: 'File did not land in the brief folder' }, 400);
      }
      return json({
        image: {
          drive_id: file.id,
          name: file.name,
          mime: file.mimeType,
          size: Number(file.size ?? 0),
        },
      });
    }

    // ── sign: mint short-lived streaming URLs ──
    if (action === 'sign') {
      const ids: string[] = Array.isArray(body.drive_ids) ? body.drive_ids : [];
      const clean = ids.map(String).filter(id => /^[\w-]{10,}$/.test(id)).slice(0, 50);
      if (!clean.length) return json({ urls: {} });

      const token = await driveAccessToken();
      const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
      const urls: Record<string, string> = {};

      for (const id of clean) {
        // Verify folder membership per id, so a signed URL can never be minted
        // for a file outside the brief folder.
        const meta = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?fields=id,parents&supportsAllDrives=true`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );
        if (!meta.ok) continue;
        const file = await meta.json();
        if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) continue;

        const sig = await hmacHex(`${id}.${exp}`, serviceKey);
        urls[id] = `${supabaseUrl}/functions/v1/chat-drive-media?id=${id}&exp=${exp}&sig=${sig}`;
      }
      return json({ urls });
    }

    // ── discard: delete an unreferenced upload ──
    if (action === 'discard') {
      const fileId = String(body.file_id ?? '');
      if (!/^[\w-]{10,}$/.test(fileId)) return json({ error: 'Invalid file id' }, 400);

      const token = await driveAccessToken();
      const meta = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,parents&supportsAllDrives=true`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      if (!meta.ok) return json({ ok: true });   // already gone
      const file = await meta.json();
      if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) {
        return json({ error: 'Not a brief image' }, 400);
      }

      // Reference counting: never delete a file some brief still uses (a body
      // may have been duplicated into another brief).
      const { data: refs } = await admin
        .from('content_briefs').select('id').or(`body.ilike.%${fileId}%,logo_url.ilike.%${fileId}%`).limit(1);
      if (refs && refs.length) return json({ ok: true, kept: true });

      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` },
      });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('brief-drive-upload error:', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
