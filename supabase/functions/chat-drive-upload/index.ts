// Supabase Edge Function: chat-drive-upload
// Authenticated. Brokers chat image/video uploads into a GOOGLE DRIVE folder
// (not Supabase Storage). The file bytes never pass through this function:
//
//   1. action 'create'   → validates the caller is an ACTIVE member of the
//                          conversation, then opens a Google Drive RESUMABLE
//                          upload session (with the browser's Origin baked in
//                          so the browser can PUT the bytes directly to
//                          googleapis.com) and returns the session URL.
//   2. (browser PUTs the file straight to the session URL, with progress)
//   3. action 'finalize' → verifies the uploaded file landed in OUR folder
//                          and returns the attachment payload the client
//                          stores on chat_messages.attachment. The file stays
//                          FULLY PRIVATE on Drive — no public permission.
//   4. action 'sign'     → for members of the conversation only: mints
//                          short-lived HMAC-signed URLs (6h) pointing at the
//                          `chat-drive-media` streaming endpoint, which is how
//                          the site renders images/videos. A leaked URL dies
//                          on expiry; the raw Drive link shows Access Denied
//                          to everyone.
//
// Auth to Google = OAuth refresh token of the company Google account, so the
// files live in (and count against) that account's Drive. Secrets required:
//   GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN,
//   GDRIVE_FOLDER_ID   (the Drive folder that receives chat uploads)
// URL signing key = SUPABASE_SERVICE_ROLE_KEY (already present; shared with
// chat-drive-media — never leaves the server).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;    // 25 MB
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;   // 512 MB
const MAX_FILE_BYTES  = 100 * 1024 * 1024;   // 100 MB — documents/archives/etc.

// Access-token cache across warm invocations of this function instance.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function driveAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
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

// HMAC-SHA256 hex of `msg` — signs the media URLs chat-drive-media verifies.
async function hmacHex(msg: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SIGN_TTL_SECONDS = 6 * 60 * 60;   // signed media URLs live 6 hours

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const folderId = Deno.env.get('GDRIVE_FOLDER_ID');
    if (!folderId || !Deno.env.get('GDRIVE_REFRESH_TOKEN')) {
      return json({ error: 'Drive uploads are not configured yet (missing GDRIVE_* secrets).' }, 500);
    }
    const admin = createClient(supabaseUrl, serviceKey);

    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Unauthorized' }, 401);
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const action: string = body.action;
    const conversationId: string = body.conversation_id;
    if (!conversationId) return json({ error: 'conversation_id required' }, 400);

    // Membership: uploads need an ACTIVE row (mirrors the "chat msg insert"
    // RLS gate); viewing signed media only needs ANY row — archived members
    // keep read-only history, like the chat RLS's is_chat_viewer.
    const { data: part } = await admin.from('chat_participants')
      .select('user_id,left_at')
      .eq('conversation_id', conversationId).eq('user_id', user.id)
      .maybeSingle();
    if (!part) return json({ error: 'Not a member of this conversation' }, 403);
    if (part.left_at && action !== 'sign') {
      return json({ error: 'Not a member of this conversation' }, 403);
    }

    // Announcement channel: posting (and so uploading) is Bob-only.
    const { data: conv } = await admin.from('chat_conversations')
      .select('id,is_announcement').eq('id', conversationId).single();
    if (!conv) return json({ error: 'Conversation not found' }, 404);
    if (conv.is_announcement) {
      const { data: prof } = await admin.from('profiles')
        .select('role').eq('id', user.id).single();
      if (prof?.role !== 'bob') return json({ error: 'Only admins can post here' }, 403);
    }

    if (action === 'create') {
      const name = String(body.name ?? 'file').slice(0, 200);
      const mime = String(body.mime ?? '');
      const size = Number(body.size ?? 0);
      const origin = String(body.origin ?? '');
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
      if (!Number.isFinite(size) || size <= 0) return json({ error: 'Invalid file size' }, 400);
      const cap = kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
      if (size > cap) {
        return json({ error: `File too large — max ${Math.round(cap / 1024 / 1024)} MB for ${kind === 'file' ? 'files' : kind + 's'}.` }, 400);
      }

      const token = await driveAccessToken();
      const initHeaders: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size),
      };
      // Baking the browser's Origin into the session lets the browser PUT the
      // bytes directly to googleapis.com (CORS on the session URL).
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
        const err = await initRes.text();
        console.error('Drive session init failed:', initRes.status, err);
        return json({ error: 'Could not start the Drive upload. Check the Drive configuration.' }, 502);
      }
      const uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) return json({ error: 'Drive did not return an upload session' }, 502);
      return json({ upload_url: uploadUrl, kind });
    }

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
      // Only files that landed in OUR chat-uploads folder can be published —
      // stops a caller from making arbitrary files of the account public.
      if (!Array.isArray(file.parents) || !file.parents.includes(folderId)) {
        return json({ error: 'File is outside the chat uploads folder' }, 403);
      }
      const kind = String(file.mimeType ?? '').startsWith('image/') ? 'image'
        : String(file.mimeType ?? '').startsWith('video/') ? 'video' : 'file';

      // Deliberately NO permission grant: the file stays private to the
      // company Google account. All viewing goes through signed URLs.
      return json({
        attachment: {
          kind,
          drive_id: file.id,
          name: file.name ?? 'file',
          mime: file.mimeType ?? '',
          size: Number(file.size ?? 0),
          url: `https://drive.google.com/file/d/${file.id}/view`,
        },
      });
    }

    if (action === 'sign') {
      const driveIds: string[] = Array.isArray(body.drive_ids)
        ? body.drive_ids.filter((x: unknown) => typeof x === 'string' && /^[\w-]{10,}$/.test(x as string))
        : [];
      if (driveIds.length === 0 || driveIds.length > 200) {
        return json({ error: 'drive_ids required' }, 400);
      }
      // Only sign files that live on a message of THIS conversation — a
      // member can't mint URLs for another chat's attachments.
      const { data: rows } = await admin.from('chat_messages')
        .select('attachment')
        .eq('conversation_id', conversationId)
        .in('attachment->>drive_id', driveIds);
      const allowed = new Set(
        (rows ?? []).map((r: any) => r.attachment?.drive_id).filter(Boolean),
      );
      const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
      const urls: Record<string, string> = {};
      for (const id of driveIds) {
        if (!allowed.has(id)) continue;
        const sig = await hmacHex(`${id}.${exp}`, serviceKey);
        urls[id] = `${supabaseUrl}/functions/v1/chat-drive-media?id=${id}&exp=${exp}&sig=${sig}`;
      }
      return json({ urls, expires_at: exp });
    }

    return json({ error: 'Unknown action' }, 400);
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
