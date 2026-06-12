-- =========================================================
-- Afflix Core — Team / brand assignment RPCs + notifications
--
-- Two SECURITY DEFINER RPCs so assignment changes can also fan out notifications
-- to the affected APC (the notifications table has no INSERT policy, and the
-- target row belongs to another user):
--
--   set_team_lead_apcs(p_lead, p_apc_ids)  — Bob sets which APCs report to a Team
--       Lead. Notifies APCs newly added to the team.
--   set_apc_brands(p_apc, p_brand_ids)     — Bob OR the managing Team Lead replaces
--       an APC's brand assignments. Notifies the APC of newly-assigned brands. A
--       Team Lead may only assign brands granted to them.
--
-- ADDITIVE: new functions only; no schema/data changes.
-- =========================================================

-- ---------- Bob: set the APC roster under a Team Lead ----------
create or replace function public.set_team_lead_apcs(p_lead uuid, p_apc_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_lead_name text; v_apc uuid; v_ids uuid[] := coalesce(p_apc_ids, '{}'::uuid[]);
begin
  if not public.is_bob() then raise exception 'Only Bob can set a Team Lead''s APCs'; end if;
  if (select role from public.profiles where id = p_lead) <> 'team_lead' then
    raise exception 'Target is not a Team Lead';
  end if;
  select coalesce(nullif(full_name,''), email) into v_lead_name from public.profiles where id = p_lead;

  -- Detach APCs that were under this lead but are no longer selected.
  update public.profiles
    set team_lead_id = null
    where role = 'apc' and team_lead_id = p_lead and not (id = any(v_ids));

  -- Attach selected APCs; notify only those whose lead actually changes to this one.
  foreach v_apc in array v_ids loop
    if exists (select 1 from public.profiles where id = v_apc and role = 'apc') then
      if (select team_lead_id from public.profiles where id = v_apc) is distinct from p_lead then
        update public.profiles set team_lead_id = p_lead where id = v_apc and role = 'apc';
        insert into public.notifications (user_id, type, title, body, link, payload)
        values (v_apc, 'team_assignment',
                'You''ve been added to a team',
                'You now report to ' || coalesce(v_lead_name, 'a Team Lead') || '.',
                '/brands',
                jsonb_build_object('team_lead_id', p_lead, 'kind', 'apc_assigned'));
      end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.set_team_lead_apcs(uuid, uuid[]) from public;
grant execute on function public.set_team_lead_apcs(uuid, uuid[]) to authenticated;

-- ---------- Bob / Team Lead: replace an APC's brands + notify ----------
create or replace function public.set_apc_brands(p_apc uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_bob boolean := public.is_bob();
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
  bid uuid;
begin
  -- Authorize: Bob, or the Team Lead who manages this APC.
  if not v_is_bob and not public.manages_apc(p_apc) then
    raise exception 'not allowed';
  end if;
  if (select role from public.profiles where id = p_apc) <> 'apc' then
    raise exception 'Target is not an APC';
  end if;

  -- A Team Lead may only assign brands Bob granted them.
  if not v_is_bob then
    foreach bid in array v_ids loop
      if not public.team_lead_has_brand(bid) then
        raise exception 'You can only assign brands that have been assigned to you';
      end if;
    end loop;
  end if;

  -- Brands newly added (for the notification), computed before we rewrite the set.
  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.apc_brands where apc_id = p_apc and brand_id = b);

  delete from public.apc_brands where apc_id = p_apc;
  if array_length(v_ids, 1) > 0 then
    insert into public.apc_brands (apc_id, brand_id) select p_apc, unnest(v_ids);
  end if;

  if v_added is not null and array_length(v_added, 1) > 0 then
    select string_agg(name, ', ' order by name) into v_names from public.brands where id = any(v_added);
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_apc, 'brand_assignment',
            'New brand' || case when array_length(v_added,1) > 1 then 's' else '' end || ' assigned to you',
            coalesce(v_names, 'A brand'),
            '/brands',
            jsonb_build_object('brand_ids', to_jsonb(v_added), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_apc_brands(uuid, uuid[]) from public;
grant execute on function public.set_apc_brands(uuid, uuid[]) to authenticated;
