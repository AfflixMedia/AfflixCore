// Supabase Edge Function: chat-drive-media
// PUBLIC endpoint (deployed with --no-verify-jwt) that streams a PRIVATE
// Google Drive chat attachment to the browser — the <img>/<video> tags can't
// send auth headers, so access is granted by a short-lived HMAC-signed URL
// minted by `chat-drive-upload` action 'sign' (which checks the caller's
// website login + membership of the conversation the file belongs to).
//
//   GET ?id=<driveFileId>&exp=<unixSeconds>&sig=<hmacSha256Hex>
//
// sig = HMAC-SHA256(`${id}.${exp}`, SUPABASE_SERVICE_ROLE_KEY). Nothing about
// the URL grants Drive access — the file stays private; this function reads
// it with the company account's OAuth refresh token and pipes the bytes
// through, forwarding Range headers so video seeking works.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'range, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges, content-type',
};

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

async function hmacHex(msg: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish compare (both sides are fixed-length hex).
function sigEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: cors });
  }
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') ?? '';
    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    if (!/^[\w-]{10,}$/.test(id) || !/^\d{10}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) {
      return new Response('Bad request', { status: 400, headers: cors });
    }
    if (Number(exp) < Math.floor(Date.now() / 1000)) {
      return new Response('Link expired', { status: 403, headers: cors });
    }
    const expected = await hmacHex(`${id}.${exp}`, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    if (!sigEqual(sig, expected)) {
      return new Response('Invalid signature', { status: 403, headers: cors });
    }

    const token = await driveAccessToken();
    const range = req.headers.get('range');
    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
      { headers: { 'Authorization': `Bearer ${token}`, ...(range ? { 'Range': range } : {}) } },
    );
    if (!(driveRes.ok || driveRes.status === 206)) {
      console.error('Drive fetch failed:', driveRes.status, await driveRes.text());
      return new Response('File not found', { status: 404, headers: cors });
    }

    const headers = new Headers(cors);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = driveRes.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    // Browser may cache privately for the signed window; the URL itself expires.
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(driveRes.body, { status: driveRes.status, headers });
  } catch (e) {
    console.error('chat-drive-media error:', (e as Error).message);
    return new Response('Server error', { status: 500, headers: cors });
  }
});
