// Supabase Edge Function: normalize-brief
//
// Re-shapes an IMPORTED brief (any doc structure) into the canonical Markdown
// the reading page understands — the reference-video / hooks / overlays / angle
// / do-don't layout — WITHOUT editing a single word of the copy.
//
// Why AI: imported docs come in every possible structure (h1 vs h3 sections,
// video tables named "Creative Concepts", angles as numbered lists, sibling
// DOs/DON'Ts headings…). Heuristics can't generalise; an LLM re-tags structure
// reliably. Only the STRUCTURE is AI-decided.
//
// Why it's safe ("do not edit content"): a server-side CONTENT GUARD compares
// the word multiset (and image markers + links) of the model's output against
// the input. If anything was dropped or altered — or too much was added — the
// output is REJECTED and the original imported Markdown is returned unchanged.
// So the worst case is "no improvement", never "content changed".
//
// Runs ONCE per import (not per view). Non-streaming: returns
//   { markdown: string, ai: boolean, reason?: string }.
//
// Deploy:  supabase functions deploy normalize-brief
// Secrets: OPENROUTER_API_KEY (required). Optional OPENROUTER_NORMALIZE_MODEL
//          (defaults to OPENROUTER_MODEL, then a free model). SUPABASE_URL /
//          SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// Access:  same as the brief tools — Super Boss, or a paid_collab_handler with
//          profiles.ai_brief_enabled.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { NORMALIZE_BRIEF_SYSTEM } from './systemPrompt.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// A capable-enough FREE model by default; override with OPENROUTER_NORMALIZE_MODEL
// (or it falls back to whatever OPENROUTER_MODEL the generator uses).
const DEFAULT_FREE_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const MAX_TOKENS = 16000;
const MAX_INPUT_CHARS = 60000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/* ── content guard ──────────────────────────────────────────────
   The AI may only RESTRUCTURE, never edit. We verify by comparing the two
   texts as word multisets: nothing from the source may go missing (that would
   mean copy was dropped or reworded), and only a small budget of words may be
   added (section labels + "Video #N"/"Format Example"/"Focus" markers). Image
   markers and links are checked for survival too. */

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’′‵]/g, "'")      // curly apostrophes → '
    .replace(/[“”″]/g, '"')            // curly quotes → "
    .replace(/[–—−]/g, '-')            // en/em dash → -
    .replace(/ /g, ' ');                         // nbsp → space
}

function words(md: string): string[] {
  const t = normalizeText(md)
    .replace(/^#{1,6}\s+/gm, ' ')                     // drop heading hashes (kept as words)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // image markers handled separately
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, ' $1 $2 ');  // links → keep label + url words
  return t.match(/[a-z0-9']+/g) ?? [];
}

function multiset(arr: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of arr) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}

// Structural vocabulary the model is allowed to add/rename freely (section
// labels + markers). Excluded from the guard on BOTH sides, so heading tweaks
// and canonical markers never look like content changes — only the actual copy
// (hooks, descriptions, do/don't items…) is compared.
const STRUCT = new Set([
  'video', 'videos', 'reference', 'references', 'format', 'example', 'examples',
  'focus', 'content', 'angle', 'angles', 'hook', 'hooks', 'overlay', 'overlays',
  'caption', 'captions', 'do', 'dos', "do's", 'don', "don't", "don'ts", 'dont', 'donts',
  'brand', 'brands', 'intro', 'introduction', 'product', 'products', 'title', 'section', 'sections',
]);

const contentWords = (md: string) => words(md).filter(w => !STRUCT.has(w));
const driveIds = (md: string) => (md.match(/drive:[A-Za-z0-9_-]{6,}/gi) ?? []).map(s => s.toLowerCase());

/**
 * Returns null if the output faithfully preserves the input's CONTENT, else a
 * reason. Compares content-word multisets (structural labels excluded): source
 * words going missing means copy was dropped or reworded; a burst of new words
 * means copy was fabricated. Not a cryptographic guarantee (an equal-length
 * synonym swap is undetectable) but a strong net against any gross edit — and
 * the prompt + temperature 0 make small edits unlikely.
 */
function guardReason(src: string, out: string): string | null {
  const s = multiset(contentWords(src));
  const o = multiset(contentWords(out));
  let missing = 0;
  for (const [w, c] of s) missing += Math.max(0, c - (o.get(w) ?? 0));
  let foreign = 0;
  for (const [w, c] of o) foreign += Math.max(0, c - (s.get(w) ?? 0));

  const n = contentWords(src).length;
  // Kept tight: the prompt says preserve headings verbatim, so legitimate
  // restructuring drops ~0 content words. A reworded line drops several.
  const missingBudget = Math.max(3, Math.round(n * 0.006));
  if (missing > missingBudget) return `dropped/altered ${missing} content words`;

  // Marker digits + the odd relabelled word; a fabricated paragraph blows past.
  const foreignBudget = Math.max(12, Math.round(n * 0.04));
  if (foreign > foreignBudget) return `added ${foreign} new words`;

  const srcImgs = new Set(driveIds(src));
  const outImgs = new Set(driveIds(out));
  for (const id of srcImgs) if (!outImgs.has(id)) return 'dropped an image';

  return null;
}

/** Strips accidental code fences / lead-in the model sometimes adds. */
function cleanOutput(raw: string): string {
  let t = raw.trim();
  const fence = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // ── auth: explicit JWT validation (service-role client), same as the
    //    chat/brief uploaders. Never getUser() with no argument. ──
    const admin = createClient(supabaseUrl, serviceKey);
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401);

    const { data: prof } = await admin
      .from('profiles').select('role, is_superbob, ai_brief_enabled').eq('id', user.id).single();
    const allowed = !!prof && (
      (prof.role === 'paid_collab_handler' && prof.ai_brief_enabled === true)
      || (prof.role === 'bob' && prof.is_superbob === true)
    );
    if (!allowed) return json({ error: 'Forbidden — no AI Content Brief access.' }, 403);

    const body = await req.json().catch(() => ({}));
    const markdown = String(body?.markdown ?? '');
    if (!markdown.trim()) return json({ error: 'markdown is required' }, 400);

    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    // No key, or the doc is huge → skip AI, return the import unchanged. The
    // caller already has a working (if rougher) layout, so this never blocks.
    if (!apiKey) return json({ markdown, ai: false, reason: 'no OPENROUTER_API_KEY' });
    if (markdown.length > MAX_INPUT_CHARS) return json({ markdown, ai: false, reason: 'too large for AI' });

    const model = Deno.env.get('OPENROUTER_NORMALIZE_MODEL')
      || Deno.env.get('OPENROUTER_MODEL')
      || DEFAULT_FREE_MODEL;

    let aiText = '';
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': Deno.env.get('OPENROUTER_SITE_URL') ?? 'https://afflixmedia.com',
          'X-Title': 'Afflix Core - Brief Normalize',
        },
        body: JSON.stringify({
          model,
          max_tokens: MAX_TOKENS,
          temperature: 0,
          messages: [
            { role: 'system', content: NORMALIZE_BRIEF_SYSTEM },
            { role: 'user', content: markdown },
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return json({ markdown, ai: false, reason: `model error ${res.status}: ${detail.slice(0, 140)}` });
      }
      const data = await res.json();
      aiText = cleanOutput(String(data?.choices?.[0]?.message?.content ?? ''));
    } catch (e) {
      return json({ markdown, ai: false, reason: `model call failed: ${(e as Error).message}` });
    }

    if (!aiText.trim()) return json({ markdown, ai: false, reason: 'empty model output' });

    // The guard is what enforces "do not edit content": reject → return source.
    const bad = guardReason(markdown, aiText);
    if (bad) return json({ markdown, ai: false, reason: `guard rejected (${bad})` });

    return json({ markdown: aiText, ai: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
