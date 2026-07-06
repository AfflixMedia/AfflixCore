// Supabase Edge Function: create-ads-manager
// Bob calls this to create a new Ads Manager user (email + password) and assign brands.
// Ads Managers view their brands read-only, except GMV Max (full edit) and the
// paid-collab video "Authorised" toggle.
// Deploy: supabase functions deploy create-ads-manager
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by Supabase)

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

    // 1. Verify caller is Bob using their JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userRes.user) {
      return json({ error: 'Not authenticated' }, 401);
    }
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', userRes.user.id).single();
    if (callerProfile?.role !== 'bob') {
      return json({ error: 'Forbidden — only Bob can create Ads Managers' }, 403);
    }

    // 2. Parse + validate body
    const { email, password, full_name, brand_ids } = await req.json();
    if (!email || !password || !Array.isArray(brand_ids)) {
      return json({ error: 'email, password, brand_ids required' }, 400);
    }
    if (String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
    if (String(password).length > 72) return json({ error: 'Password must be 72 characters or fewer' }, 400);

    // Only brands with the 'ads' (GMV Max) scope can be assigned to an Ads Manager.
    if (brand_ids.length > 0) {
      const { data: scoped } = await admin.from('brands').select('id,name,scope').in('id', brand_ids);
      const bad = (scoped ?? []).filter((b: { scope: string[] | null }) => !(b.scope ?? []).includes('ads'));
      if (bad.length > 0 || (scoped ?? []).length !== brand_ids.length) {
        const names = bad.map((b: { name: string }) => b.name).join(', ');
        return json({ error: `Only brands with the GMV Max scope can be assigned to an Ads Manager${names ? ` (not: ${names})` : ''}.` }, 400);
      }
    }

    // 3. Create the auth user (email auto-confirmed so they can log in immediately)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    });
    if (createErr || !created.user) {
      const msg = createErr?.message ?? 'Could not create user';
      if (/already|registered|exists/i.test(msg)) {
        return json({ error: 'A user with this email already exists.' }, 409);
      }
      return json({ error: msg }, 400);
    }
    const newUserId = created.user.id;

    // 4. Upsert profile with role=ads_manager (trigger may have created it as 'pending').
    const { error: profErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: full_name ?? '',
        role: 'ads_manager',
      });
    if (profErr) return json({ error: profErr.message }, 400);

    // 5. Assign brands (no exclusivity — an Ads Manager coexists with the brand's APC/Team Lead)
    if (brand_ids.length > 0) {
      const rows = brand_ids.map((bid: string) => ({ ads_manager_id: newUserId, brand_id: bid }));
      const { error: asgErr } = await admin.from('ads_manager_brands').insert(rows);
      if (asgErr) return json({ error: asgErr.message }, 400);
    }

    // 6. Welcome notification — which brands they got.
    try {
      if (brand_ids.length > 0) {
        const { data: bs } = await admin.from('brands').select('name').in('id', brand_ids);
        const names = (bs ?? []).map((b: { name: string }) => b.name).join(', ');
        await admin.from('notifications').insert({
          user_id: newUserId, type: 'brand_assignment',
          title: `Brand${brand_ids.length > 1 ? 's' : ''} assigned to you`,
          body: names || 'A brand',
          link: '/brands',
          payload: { brand_ids, kind: 'brand_assigned' },
        });
      }
    } catch (_) { /* notifications are best-effort */ }

    return json({ id: newUserId, email });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
