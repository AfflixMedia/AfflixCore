-- =========================================================
-- Afflix Core — Promote an existing APC to Team Lead (Bob-only)
--
-- One atomic, data-safe operation so Bob can upgrade an APC without touching any
-- of their authored content. What it does:
--   1. Copies the APC's brand assignments (apc_brands) into team_lead_brands so
--      they keep the exact same brands — now as a Team Lead's Bob-granted set.
--   2. Removes the now-redundant apc_brands rows so they're a clean Team Lead
--      (the assignment info is preserved in step 1, just moved to the right table).
--   3. Flips role -> 'team_lead', grants the lead flags, detaches from any parent.
--
-- DATA SAFETY: the person's reports (weekly_reports/monthly_reports.created_by),
-- comments, chat messages, notifications and every other authored row are keyed by
-- their user id and are NOT touched. Only role / flags / brand-assignment bookkeeping
-- changes. The whole thing runs in one transaction (the function body), so it either
-- fully succeeds or fully rolls back.
-- =========================================================

create or replace function public.promote_apc_to_team_lead(p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_bob() then
    raise exception 'Only Bob can promote a user to Team Lead';
  end if;

  select role into v_role from public.profiles where id = p_apc;
  if v_role is null then raise exception 'User not found'; end if;
  if v_role <> 'apc' then raise exception 'Only an APC can be promoted to Team Lead'; end if;

  -- 1. Carry their brands over to the Team Lead grant table (idempotent).
  insert into public.team_lead_brands (team_lead_id, brand_id)
  select p_apc, ab.brand_id from public.apc_brands ab where ab.apc_id = p_apc
  on conflict do nothing;

  -- 2. Drop the redundant APC assignments (already copied above).
  delete from public.apc_brands where apc_id = p_apc;

  -- 3. Flip role + grant lead flags + detach from any parent Team Lead.
  update public.profiles
    set role = 'team_lead',
        can_edit_brands = true,
        can_manage_gmv_max = true,
        team_lead_id = null
    where id = p_apc;
end;
$$;
revoke all on function public.promote_apc_to_team_lead(uuid) from public;
grant execute on function public.promote_apc_to_team_lead(uuid) to authenticated;
