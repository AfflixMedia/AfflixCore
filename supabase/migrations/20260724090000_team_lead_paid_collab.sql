-- =========================================================
-- Afflix Core — Team Leads get Paid Collab access for their brands.
--
-- Until now a Team Lead's brand grant deliberately stayed OUT of the
-- paid-collab helper user_has_brand_access() (see 20260616_team_lead_role),
-- so the Brand Detail Paid Collab tab was Bob + assigned APC only. Product
-- decision 2026-07-06: Team Leads should see (and edit, APC-level) the paid
-- collab of the brands Bob assigned them.
--
-- One change does it all: add team_lead_has_brand() to user_has_brand_access().
-- That single helper drives the RLS/RPC gates for:
--   * handler_collab_brand_months / handler_collab_creators reads (the tab's
--     Overview + Performance data, 20260626),
--   * the narrow staff-write RPCs set_handler_creator_video_auth (20260629)
--     and set_handler_creator_monthly (20260703) — whose comments already
--     said "apc / team_lead via is_internal_staff", relying on this helper,
--   * paid-collab staff comments (20260702/20260705),
--   * the legacy paid_creator_* tables and report-template brand links.
--
-- team_lead_has_brand() (20260616) is SECURITY DEFINER and stable, safe here.
-- Definition otherwise identical to 20260518_paid_collab_handlers.
-- =========================================================

create or replace function public.user_has_brand_access(b_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = b_id and ab.apc_id = auth.uid()
    )
    or public.team_lead_has_brand(b_id)
    or exists (
      select 1 from public.paid_collab_client_brands pcb
      where pcb.brand_id = b_id and pcb.client_id = auth.uid()
    )
    or exists (
      select 1 from public.paid_collab_handler_brands pchb
      where pchb.brand_id = b_id and pchb.handler_id = auth.uid()
    );
$$;
