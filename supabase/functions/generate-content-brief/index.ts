// Supabase Edge Function: generate-content-brief
//
// Generates a TikTok Shop UGC content brief from a brand name + logo + website
// + product/TikTok video links. Streams the brief back as SSE so the browser
// can render it live (a full brief with web research takes well over a minute,
// which would otherwise risk an HTTP timeout).
//
// MODEL ACCESS: OpenRouter (https://openrouter.ai), OpenAI-compatible
// /chat/completions endpoint. Model is configurable via OPENROUTER_MODEL so
// you can switch models without redeploying code.
//
// WHY THIS IS AN EDGE FUNCTION, NOT A BROWSER CALL:
// the OpenRouter key must never reach the client. A `VITE_*` env var is
// inlined into the JS bundle by Vite and is readable by anyone who opens
// DevTools. The key lives here as a Supabase secret instead.
//
// Deploy:  supabase functions deploy generate-content-brief
// Secrets: supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
//          (optional) OPENROUTER_MODEL, OPENROUTER_WEB_SEARCH,
//                     OPENROUTER_WEB_MAX_RESULTS, OPENROUTER_SITE_URL
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are
//          provided automatically.
//
// Access:  caller must be a paid_collab_handler with profiles.ai_brief_enabled,
//          or the Super Boss (migration 20260826090000_ai_brief_access.sql).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { CONTENT_BRIEF_SYSTEM } from './systemPrompt.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Override with the OPENROUTER_MODEL secret. Use OpenRouter's slug format
// (provider/model), e.g. anthropic/claude-opus-4.8 or anthropic/claude-sonnet-4.5.
const DEFAULT_MODEL = 'anthropic/claude-opus-4.8';
const MAX_TOKENS = 16000;

interface BriefInput {
  brandName?: string;
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Bullet list of links, or an explicit "none supplied" so the model researches instead. */
function linkList(links: string[] | undefined, emptyNote: string) {
  const clean = (links ?? []).map(l => String(l).trim()).filter(Boolean);
  return clean.length ? clean.map(l => `- ${l}`).join('\n') : `(none supplied — ${emptyNote})`;
}

function buildUserMessage(i: BriefInput) {
  const opt = (label: string, v?: string) => {
    const t = (v ?? '').trim();
    return t ? `\n**${label}:** ${t}` : '';
  };
  return `Build a TikTok Shop UGC content brief for the brand below.

**Brand:** ${i.brandName}
**Website:** ${i.websiteUrl || '(not supplied — find the official site)'}${opt('Logo', i.logoUrl)}

**Product / TikTok Shop links:**
${linkList(i.productLinks, 'find the brand\'s live TikTok Shop listings')}

**Reference video links (high-GMV):**
${linkList(i.videoLinks, 'research the best-selling competitor formats in this exact category')}
${opt('Competitors', i.competitors)}${opt('Selling priority (what to lead with)', i.sellingPriority)}${opt('Compliance limits / banned claims', i.complianceNotes)}${opt('Pricing / offers to push', i.pricingNotes)}${opt('Additional notes', i.extraNotes)}

Use the brand's website, product pages, press coverage and live TikTok listings as your source of facts. Follow the required structure exactly. Return only the brief in Markdown.`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const model = Deno.env.get('OPENROUTER_MODEL') || DEFAULT_MODEL;
    // OpenRouter's web plugin (Exa-backed) is the stand-in for Anthropic's
    // native web_search/web_fetch tools, which are not available through the
    // OpenAI-compatible gateway. It injects search results into the prompt
    // rather than letting the model call a tool per lookup.
    const webSearch = (Deno.env.get('OPENROUTER_WEB_SEARCH') ?? 'true') !== 'false';
    const webMaxResults = Number(Deno.env.get('OPENROUTER_WEB_MAX_RESULTS') ?? '8');

    // 1. Authenticate the caller.
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'Not authenticated' }, 401);

    // 2. Authorize — same rule as the DB helper can_use_ai_brief().
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: prof } = await admin
      .from('profiles').select('role, is_superbob, ai_brief_enabled')
      .eq('id', userRes.user.id).single();
    const allowed = !!prof && (
      (prof.role === 'paid_collab_handler' && prof.ai_brief_enabled === true)
      || (prof.role === 'bob' && prof.is_superbob === true)
    );
    if (!allowed) {
      return json({ error: 'Forbidden — you do not have AI Content Brief access. Ask the Super Boss to enable it.' }, 403);
    }

    // 3. Config + input. The key check sits AFTER authorization on purpose:
    // an anonymous caller should not be able to probe server configuration.
    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return json({ error: 'OPENROUTER_API_KEY is not configured on this function. Run: supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...' }, 500);
    }

    const input = await req.json() as BriefInput;
    if (!input?.brandName || !String(input.brandName).trim()) {
      return json({ error: 'brandName is required' }, 400);
    }

    // 4. Stream from OpenRouter, relaying simplified SSE events to the browser.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* client gone */ }
        };

        try {
          send({ type: 'status', text: webSearch ? 'Researching the brand' : 'Writing the brief' });

          const payload: Record<string, unknown> = {
            model,
            stream: true,
            max_tokens: MAX_TOKENS,
            messages: [
              { role: 'system', content: CONTENT_BRIEF_SYSTEM },
              { role: 'user', content: buildUserMessage(input) },
            ],
            // OpenRouter's unified reasoning control; ignored by models that
            // do not support it, so it is safe across model switches.
            reasoning: { effort: 'high' },
          };
          if (webSearch) {
            payload.plugins = [{ id: 'web', max_results: webMaxResults }];
          }

          const res = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              // OpenRouter attribution headers (optional but recommended).
              // ASCII ONLY: header values must be Latin-1. A non-Latin-1
              // character (an em dash, a curly quote) makes fetch() throw
              // "'headers' is not a valid ByteString" before the request is sent.
              'HTTP-Referer': Deno.env.get('OPENROUTER_SITE_URL') ?? 'https://afflixmedia.com',
              'X-Title': 'Afflix Core - Content Brief',
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok || !res.body) {
            const detail = await res.text().catch(() => '');
            let msg = `OpenRouter error (${res.status})`;
            try {
              const parsed = JSON.parse(detail);
              if (parsed?.error?.message) msg = parsed.error.message;
              else if (typeof parsed?.error === 'string') msg = parsed.error;
            } catch { if (detail) msg = detail.slice(0, 500); }
            send({ type: 'error', error: msg });
            controller.close();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let wrote = false;
          let finish: string | null = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            // OpenAI-compatible SSE: frames separated by a blank line.
            const frames = buf.split('\n\n');
            buf = frames.pop() ?? '';

            for (const frame of frames) {
              const dataLine = frame.split('\n').find(l => l.startsWith('data:'));
              if (!dataLine) continue;
              const raw = dataLine.slice(5).trim();
              if (raw === '[DONE]') { finish = finish ?? 'stop'; continue; }

              let ev: any;
              try { ev = JSON.parse(raw); } catch { continue; }

              // OpenRouter surfaces mid-stream failures as an error object.
              if (ev.error) {
                send({ type: 'error', error: ev.error.message ?? 'Generation failed' });
                controller.close();
                return;
              }

              const choice = ev.choices?.[0];
              const delta = choice?.delta?.content;
              if (typeof delta === 'string' && delta) {
                if (!wrote) { wrote = true; send({ type: 'status', text: 'Writing the brief' }); }
                send({ type: 'text', text: delta });
              }
              if (choice?.finish_reason) finish = choice.finish_reason;
            }
          }

          if (!wrote) {
            send({ type: 'error', error: 'The model returned an empty brief. Check the OPENROUTER_MODEL slug and that your account has credit.' });
            controller.close();
            return;
          }
          if (finish === 'length') {
            send({ type: 'status', text: 'Hit the length limit — the brief may be cut short' });
          }

          send({ type: 'done' });
          controller.close();
        } catch (e) {
          send({ type: 'error', error: (e as Error).message });
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
