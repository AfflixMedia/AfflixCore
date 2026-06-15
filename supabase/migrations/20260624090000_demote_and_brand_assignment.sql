-- =========================================================
-- Afflix Core — Demote Team Lead → APC + assign a brand on create/edit
--
-- Two Bob-only SECURITY DEFINER RPCs:
--
--   demote_team_lead_to_apc(p_lead)            — the exact reverse of
--       promote_apc_to_team_lead. Data-safe: detaches the lead's APCs (they fall
--       back to no team, keeping their own brands), carries the lead's *own*
--       (non-delegated) brands back as APC brands, drops the team-lead grants, and
--       flips the role back to 'apc'. Reports / comments / chat are untouched.
--
--   set_brand_assignment(p_brand, p_lead, p_apc) — set a single brand's owner from
--       the Brands page (used on both create and edit). Reconciles the one-brand→
--       one-Team-Lead and one-brand→one-APC rules for that brand:
--         • pick a Team Lead only            → brand granted to that lead
--         • pick an APC                       → brand assigned to the APC AND
--           (auto) to that APC's Team Lead if they have one
--         • pick nothing (both null)          → brand left/made unassigned
--       Notifies the APC / Team Lead only when they are *newly* given the brand.
--
-- 100% ADDITIVE: new functions only. No schema or existing-data changes.
-- =========================================================

-- ---------- 1. Demote a Team Lead back to APC (reverse of promote) ----------
create or replace function public.demote_team_lead_to_apc(p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if not public.is_bob() then
    raise exception 'Only Bob can demote a Team Lead';
  end if;

  select role into v_role from public.profiles where id = p_lead;
  if v_role is null then raise exception 'User not found'; end if;
  if v_role <> 'team_lead' then raise exception 'Only a Team Lead can be demoted to APC'; end if;

  -- 1. Detach this lead's APCs → teamless (directly under Bob). They keep their brands.
  update public.profiles set team_lead_id = null
    where role = 'apc' and team_lead_id = p_lead;

  -- 2. Carry over the lead's own (non-delegated) brands as APC brands so they keep the
  --    brands no downstream APC already holds. Delegated brands stay with that APC,
  --    which keeps one-brand→one-APC intact.
  insert into public.apc_brands (apc_id, brand_id)
  select p_lead, tlb.brand_id
  from public.team_lead_brands tlb
  where tlb.team_lead_id = p_lead
    and not exists (select 1 from public.apc_brands ab where ab.brand_id = tlb.brand_id)
  on conflict do nothing;

  -- 3. Drop the now-redundant Team Lead brand grants (preserved as APC brands above).
  delete from public.team_lead_brands where team_lead_id = p_lead;

  -- 4. Flip role back to APC, attach directly under Bob. Permission flags are left as
  --    they are — Bob can toggle them from the APC editor afterward.
  update public.profiles
    set role = 'apc',
        team_lead_id = null
    where id = p_lead;
end;
$$;
revoke all on function public.demote_team_lead_to_apc(uuid) from public;
grant execute on function public.demote_team_lead_to_apc(uuid) to authenticated;

-- ---------- 2. Set a single brand's Team Lead / APC owner (create + edit) ----------
create or replace function public.set_brand_assignment(p_brand uuid, p_lead uuid, p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_apc_existing boolean := true;   -- assume "already had it" → no notification
  v_lead_existing boolean := true;
  v_bname text;
begin
  if not public.is_bob() then raise exception 'Only Bob can assign brands'; end if;
  if not exists (select 1 from public.brands where id = p_brand) then raise exception 'Brand not found'; end if;

  -- Validate the APC (if any) and derive the effective Team Lead from the APC's own
  -- team, falling back to the explicitly chosen lead.
  if p_apc is not null then
    if (select role from public.profiles where id = p_apc) <> 'apc' then
      raise exception 'Target is not an APC';
    end if;
    v_lead := coalesce((select team_lead_id from public.profiles where id = p_apc), p_lead);
  else
    v_lead := p_lead;
  end if;

  if v_lead is not null and (select role from public.profiles where id = v_lead) <> 'team_lead' then
    raise exception 'Target is not a Team Lead';
  end if;

  -- ---- Team Lead grant (one brand → one lead) ----
  delete from public.team_lead_brands
    where brand_id = p_brand and (v_lead is null or team_lead_id <> v_lead);
  if v_lead is not null then
    select exists (select 1 from public.team_lead_brands where brand_id = p_brand and team_lead_id = v_lead)
      into v_lead_existing;
    insert into public.team_lead_brands (team_lead_id, brand_id) values (v_lead, p_brand)
      on conflict do nothing;
  end if;

  -- ---- APC grant (one brand → one APC) ----
  delete from public.apc_brands
    where brand_id = p_brand and (p_apc is null or apc_id <> p_apc);
  if p_apc is not null then
    select exists (select 1 from public.apc_brands where brand_id = p_brand and apc_id = p_apc)
      into v_apc_existing;
    insert into public.apc_brands (apc_id, brand_id) values (p_apc, p_brand)
      on conflict do nothing;
  end if;

  select name into v_bname from public.brands where id = p_brand;

  -- Notify the APC when newly assigned.
  if p_apc is not null and not v_apc_existing then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_apc, 'brand_assignment', 'New brand assigned to you',
            coalesce(v_bname, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(array[p_brand]), 'kind', 'brand_assigned'));
  end if;

  -- Notify the Team Lead when newly granted.
  if v_lead is not null and not v_lead_existing then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_lead, 'brand_assignment', 'New brand assigned to you',
            coalesce(v_bname, 'A brand'), '/brands',
            jsonb_build_object('brand_ids', to_jsonb(array[p_brand]), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_brand_assignment(uuid, uuid, uuid) from public;
grant execute on function public.set_brand_assignment(uuid, uuid, uuid) to authenticated;
