// Supabase Edge Function: create-apc
// Bob calls this to create a new APC user (email + password) and assign brands.
// Deploy: supabase functions deploy create-apc --no-verify-jwt=false
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
      return json({ error: 'Forbidden — only Bob can create APCs' }, 403);
    }

    // 2. Parse + validate body. `role` defaults to 'apc' for backwards compat.
    const body = await req.json();
    const { email, password, full_name, can_edit_brands, can_manage_gmv_max } = body;
    const role: string = body.role ?? 'apc';
    const brand_ids: string[] = Array.isArray(body.brand_ids) ? body.brand_ids : [];
    const ALLOWED_ROLES = ['apc', 'affiliate_tl', 'paid_collab_tl', 'operation_lead', 'ipc', 'developer'];
    if (!ALLOWED_ROLES.includes(role)) {
      return json({ error: `Invalid role: ${role}` }, 400);
    }
    if (!email || !password) {
      return json({ error: 'email and password required' }, 400);
    }

    // 3. Create the auth user (email auto-confirmed so they can sign in immediately)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    });
    if (createErr || !created.user) {
      return json({ error: createErr?.message ?? 'Could not create user' }, 400);
    }
    const newUserId = created.user.id;

    // 4. Upsert profile with the requested role
    const { error: profErr } = await admin
      .from('profiles')
      .upsert({
        id: newUserId,
        email,
        full_name: full_name ?? '',
        role,
        can_edit_brands: !!can_edit_brands,
        can_manage_gmv_max: !!can_manage_gmv_max,
      });
    if (profErr) return json({ error: profErr.message }, 400);

    // 5. Brand assignment (APC only — other roles don't have a join table for now)
    if (role === 'apc' && brand_ids.length > 0) {
      const rows = brand_ids.map((bid: string) => ({ apc_id: newUserId, brand_id: bid }));
      const { error: asgErr } = await admin.from('apc_brands').insert(rows);
      if (asgErr) return json({ error: asgErr.message }, 400);
    }

    return json({ id: newUserId, email, role });
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
