import { supabase } from '../../../lib/supabase';

/* ════════════════════════════════════════════════════════════
   Client for the `generate-content-brief` edge function.

   Uses raw fetch rather than supabase.functions.invoke because the function
   streams Server-Sent Events (a brief with web research runs well past a
   normal request), and invoke() buffers the whole response.

   The OpenRouter key never appears here — it lives as a Supabase secret on the
   edge function. Never move it into a VITE_* var: Vite inlines those into the
   browser bundle in plain text.
════════════════════════════════════════════════════════════ */

export interface BriefInput {
  brandName: string;
  websiteUrl?: string;
  logoUrl?: string;
  productLinks?: string[];
  videoLinks?: string[];
  competitors?: string;
  sellingPriority?: string;
  complianceNotes?: string;
  pricingNotes?: string;
  extraNotes?: string;
  month?: string;
}

export interface BriefHandlers {
  /** Markdown chunk appended to the brief as it is written. */
  onText: (chunk: string) => void;
  /** Human-readable progress ("Searching the web", "Writing the brief"). */
  onStatus?: (status: string) => void;
  signal?: AbortSignal;
}

/**
 * Streams a generated brief. Resolves when the stream completes; rejects with a
 * readable message on auth/config/API failure. Aborting via `signal` resolves
 * quietly with whatever was streamed so far.
 */
/**
 * Restructures imported-doc Markdown into the canonical brief shape via the
 * `normalize-brief` edge function (AI reshapes STRUCTURE only; a server guard
 * rejects any content change and returns the input untouched). Best-effort: on
 * any failure it resolves with the original markdown, so an import never breaks.
 * Returns whether the AI version was used.
 */
export async function normalizeBriefStructure(markdown: string): Promise<{ markdown: string; ai: boolean }> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!token || !baseUrl || !anonKey) return { markdown, ai: false };

    const res = await fetch(`${baseUrl}/functions/v1/normalize-brief`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.markdown) return { markdown, ai: false };
    return { markdown: String(body.markdown), ai: !!body.ai };
  } catch {
    return { markdown, ai: false };
  }
}

export async function generateBrief(input: BriefInput, h: BriefHandlers): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('You are signed out. Refresh the page and try again.');

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase is not configured in this environment.');

  const res = await fetch(`${baseUrl}/functions/v1/generate-content-brief`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
    signal: h.signal,
  });

  // Non-streaming failures (401/403/500) come back as plain JSON.
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* keep the status message */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let failure: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }

        if (ev.type === 'text') h.onText(ev.text);
        else if (ev.type === 'status') h.onStatus?.(ev.text);
        else if (ev.type === 'error') { failure = ev.error || 'Generation failed'; }
        else if (ev.type === 'done') { /* stream ends naturally */ }
      }
    }
  } catch (e) {
    // Deliberate cancellation keeps the partial brief on screen.
    if ((e as Error).name === 'AbortError') return;
    throw e;
  }

  if (failure) throw new Error(failure);
}

/* ════════════════════════════════════════════════════════════
   Saved briefs (public.content_briefs, migration 20260827090000)
   Editable in the app, publishable behind a read-only /brief/:token page.
════════════════════════════════════════════════════════════ */

export interface SavedBrief {
  id: string;
  brand_id: string | null;
  brand_name: string;
  month: string | null;
  website_url: string | null;
  logo_url: string | null;
  title: string | null;
  body: string;
  share_token: string;
  share_enabled: boolean;
  updated_at: string;
  created_at: string;
}

const BRIEF_COLS =
  'id,brand_id,brand_name,month,website_url,logo_url,title,body,share_token,share_enabled,updated_at,created_at';

/** Briefs visible to the caller, newest first. RLS scopes the rows. */
export async function listBriefs(): Promise<SavedBrief[]> {
  const { data, error } = await supabase
    .from('content_briefs').select(BRIEF_COLS)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedBrief[];
}

/** Inserts a brief. `created_by` is stamped by a DB trigger, never by the client. */
export async function createBrief(row: {
  brand_id?: string | null;
  brand_name: string;
  month?: string | null;
  website_url?: string | null;
  logo_url?: string | null;
  title?: string | null;
  body: string;
  inputs?: Record<string, unknown>;
}): Promise<SavedBrief> {
  const { data, error } = await supabase
    .from('content_briefs').insert(row).select(BRIEF_COLS).single();
  if (error) throw error;
  return data as SavedBrief;
}

export async function updateBrief(
  id: string,
  patch: Partial<Pick<SavedBrief, 'body' | 'title' | 'share_enabled' | 'brand_name' | 'logo_url' | 'website_url'>>,
): Promise<SavedBrief> {
  const { data, error } = await supabase
    .from('content_briefs').update(patch).eq('id', id).select(BRIEF_COLS).single();
  if (error) throw error;
  return data as SavedBrief;
}

export async function deleteBrief(id: string): Promise<void> {
  const { error } = await supabase.from('content_briefs').delete().eq('id', id);
  if (error) throw error;
}

/** Public URL for a brief's read-only view. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/brief/${token}`;
}

/* ════════════════════════════════════════════════════════════
   Brief IMAGES — stored on Google Drive, not Supabase.

   Only the brief TEXT lives in Postgres. Uploaded logos and any images placed
   in the brief go to the company Drive folder via `brief-drive-upload`, the
   same model as chat attachments: the file stays fully private, and the app
   renders it through short-lived HMAC-signed URLs.

   The brief stores a stable `drive:<fileId>` marker, never a signed URL —
   URLs expire in 6h, so storing one would break every shared brief overnight.
   Fresh URLs are minted per render (here for staff, and inside
   get-shared-brief for the public page).
════════════════════════════════════════════════════════════ */

export interface BriefImage {
  drive_id: string;
  name: string;
  mime: string;
  size: number;
}

async function briefDrive(action: string, payload: Record<string, unknown>) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error('You are signed out. Refresh the page and try again.');

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase is not configured in this environment.');

  const res = await fetch(`${baseUrl}/functions/v1/brief-drive-upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`);
  return body;
}

/**
 * Uploads an image to the Drive brief folder. The bytes go browser → Drive
 * directly (resumable session), so nothing large passes through the function.
 * Returns the `drive_id` to store as `drive:<id>` in the brief.
 */
export async function uploadBriefImage(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<BriefImage> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be added to a brief.');

  const { upload_url } = await briefDrive('create', {
    name: file.name, mime: file.type, size: file.size, origin: window.location.origin,
  });

  const driveId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload_url, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).id); }
        catch { reject(new Error('Drive did not return a file id.')); }
      } else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(file);
  });

  const { image } = await briefDrive('finalize', { file_id: driveId });
  return image as BriefImage;
}

/** Mints signed streaming URLs for Drive ids: { driveId: url }. */
export async function signBriefImages(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { urls } = await briefDrive('sign', { drive_ids: ids });
  return (urls ?? {}) as Record<string, string>;
}

/** Deletes an image no brief references (cancelled or replaced upload). */
export async function discardBriefImage(driveId: string): Promise<void> {
  try { await briefDrive('discard', { file_id: driveId }); } catch { /* best effort */ }
}

export interface PublicBrief {
  brand_name: string;
  title: string | null;
  body: string;
  logo_url: string | null;
  website_url: string | null;
  month: string | null;
  updated_at: string;
}

/**
 * Fetches a shared brief by token for the public read view. No auth: the token
 * is the credential, and the edge function enforces share_enabled.
 */
export async function fetchSharedBrief(
  token: string,
): Promise<{ brief: PublicBrief; images: Record<string, string> }> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) throw new Error('Supabase is not configured in this environment.');

  // The anon key rides in BOTH headers: the gateway's JWT check (verify_jwt)
  // only looks at Authorization, so without it the public page 401s whenever
  // the function is deployed without --no-verify-jwt. The anon key is a valid
  // JWT, so this works with the flag in either state.
  const res = await fetch(`${baseUrl}/functions/v1/get-shared-brief`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ token }),
  });

  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(body?.error || `Could not load this brief (${res.status}).`);
  if (!body?.brief) throw new Error('Could not load this brief.');
  // `images` maps each drive:<id> in the brief to a freshly signed URL, minted
  // server-side on this request so shared links never show broken images.
  return {
    brief: body.brief as PublicBrief,
    images: (body.images ?? {}) as Record<string, string>,
  };
}
