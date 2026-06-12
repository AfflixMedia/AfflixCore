-- =========================================================
-- Afflix Core — Assignment rules + reassignment notifications
--
-- 1. Reassigning an APC between teams now notifies the APC AND the previous Team
--    Lead (instead of silently moving them).
-- 2. Brand ownership is exclusive:
--      • one brand -> at most one Team Lead   (best-effort unique on the recent
--        team_lead_brands table + enforced in the UI)
--      • one brand -> at most one APC         (enforced in set_apc_brands + UI)
--    A Team Lead may still hold many brands; an APC may still hold many brands.
-- 3. Approving a report now also notifies Bob (the APC/creator is already notified).
--
-- DATA SAFETY: NO existing data is deleted. apc_brands edits are now a *diff* —
-- only the brands you actually unticked for that one APC are removed, nothing else.
-- brands and other APCs' rows are never touched. The team_lead_brands unique
-- constraint is added best-effort (skipped silently if it can't apply) — no rows
-- are deleted to make it fit.
-- =========================================================

-- ---------- 1. Best-effort: one Team Lead per brand (recent table only) ----------
do $$
begin
  begin
    alter table public.team_lead_brands add constraint team_lead_brands_brand_uniq unique (brand_id);
  exception when others then
    null;  -- already present, or pre-existing duplicates; the UI also prevents it.
  end;
end $$;

-- ---------- 2. Roster changes notify APC + previous lead ----------
create or replace function public.set_team_lead_apcs(p_lead uuid, p_apc_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_lead_name text; v_apc uuid; v_old uuid; v_apc_name text; v_ids uuid[] := coalesce(p_apc_ids, '{}'::uuid[]);
begin
  if not public.is_bob() then raise exception 'Only Bob can set a Team Lead''s APCs'; end if;
  if (select role from public.profiles where id = p_lead) <> 'team_lead' then
    raise exception 'Target is not a Team Lead';
  end if;
  select coalesce(nullif(full_name,''), email) into v_lead_name from public.profiles where id = p_lead;

  -- Detach APCs removed from this lead's roster → notify them.
  for v_apc in
    select id from public.profiles where role = 'apc' and team_lead_id = p_lead and not (id = any(v_ids))
  loop
    update public.profiles set team_lead_id = null where id = v_apc;
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_apc, 'team_assignment', 'You were removed from a team',
            'You are no longer on ' || coalesce(v_lead_name, 'a Team Lead') || '''s team.',
            '/brands', jsonb_build_object('team_lead_id', p_lead, 'kind', 'apc_removed'));
  end loop;

  -- Attach selected APCs; notify the APC, and the previous lead if they moved.
  foreach v_apc in array v_ids loop
    if exists (select 1 from public.profiles where id = v_apc and role = 'apc') then
      select team_lead_id into v_old from public.profiles where id = v_apc;
      if v_old is distinct from p_lead then
        update public.profiles set team_lead_id = p_lead where id = v_apc and role = 'apc';
        select coalesce(nullif(full_name,''), email) into v_apc_name from public.profiles where id = v_apc;

        insert into public.notifications (user_id, type, title, body, link, payload)
        values (v_apc, 'team_assignment', 'You''ve been added to a team',
                'You now report to ' || coalesce(v_lead_name, 'a Team Lead') || '.',
                '/brands', jsonb_build_object('team_lead_id', p_lead, 'kind', 'apc_assigned'));

        if v_old is not null then
          insert into public.notifications (user_id, type, title, body, link, payload)
          values (v_old, 'team_assignment', 'An APC left your team',
                  coalesce(v_apc_name, 'An APC') || ' was moved to another team.',
                  '/apcs', jsonb_build_object('apc_id', v_apc, 'kind', 'apc_moved_out'));
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- ---------- 2b. One APC per brand — diff-based, never bulk-deletes ----------
create or replace function public.set_apc_brands(p_apc uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_is_bob boolean := public.is_bob();
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
  v_other uuid;
  bid uuid;
begin
  if not v_is_bob and not public.manages_apc(p_apc) then raise exception 'not allowed'; end if;
  if (select role from public.profiles where id = p_apc) <> 'apc' then raise exception 'Target is not an APC'; end if;

  -- A Team Lead may only assign brands granted to them.
  if not v_is_bob then
    foreach bid in array v_ids loop
      if not public.team_lead_has_brand(bid) then
        raise exception 'You can only assign brands that have been assigned to you';
      end if;
    end loop;
  end if;

  -- One brand -> one APC: reject brands already held by a different APC.
  foreach bid in array v_ids loop
    select apc_id into v_other from public.apc_brands where brand_id = bid and apc_id <> p_apc limit 1;
    if v_other is not null then
      raise exception 'That brand is already assigned to another APC — unassign it there first';
    end if;
  end loop;

  -- Brands newly added (for the notification).
  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.apc_brands where apc_id = p_apc and brand_id = b);

  -- DIFF: only remove the brands this APC no longer has; add the new ones.
  delete from public.apc_brands where apc_id = p_apc and not (brand_id = any(v_ids));
  if v_added is not null and array_length(v_added, 1) > 0 then
    insert into public.apc_brands (apc_id, brand_id) select p_apc, unnest(v_added);
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

-- ---------- 3. Approving a report also notifies Bob ----------
create or replace function public.decide_report_review(p_kind text, p_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand uuid; v_creator uuid; v_name text; v_label text; v_link text; v_clean text;
begin
  if p_kind not in ('weekly','monthly') then raise exception 'invalid report kind'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  v_clean := nullif(btrim(coalesce(p_note,'')), '');

  if p_kind = 'weekly' then
    select brand_id, created_by into v_brand, v_creator from public.weekly_reports where id = p_id;
  else
    select brand_id, created_by into v_brand, v_creator from public.monthly_reports where id = p_id;
  end if;
  if v_brand is null then raise exception 'report not found'; end if;

  if not public.is_bob()
     and not exists (select 1 from public.team_lead_brands where brand_id = v_brand and team_lead_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  if p_kind = 'weekly' then
    update public.weekly_reports
      set review_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_clean
      where id = p_id;
    v_link := '/reporting/weekly/' || p_id::text;
  else
    update public.monthly_reports
      set review_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_clean
      where id = p_id;
    v_link := '/reporting/monthly/' || p_id::text;
  end if;

  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = auth.uid();
  select name into v_label from public.brands where id = v_brand;

  -- Notify the report's creator (APC) — both approve and reject.
  if v_creator is not null and v_creator <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (v_creator, 'report_review',
            coalesce(v_name,'Your Team Lead') || ' '
              || case when p_decision = 'approved' then 'approved' else 'requested changes on' end
              || ' your report',
            coalesce(v_label,'A brand') || ' — ' || p_kind || ' report'
              || case when v_clean is not null then ': ' || v_clean else '' end,
            v_link,
            jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                               'brand_id', v_brand, 'kind', p_decision));
  end if;

  -- On approval, also notify Bob(s) that the report has been reviewed.
  if p_decision = 'approved' then
    insert into public.notifications (user_id, type, title, body, link, payload)
    select pr.id, 'report_review',
           'Report reviewed & approved',
           coalesce(v_label,'A brand') || ' — ' || p_kind || ' report approved by ' || coalesce(v_name,'a Team Lead'),
           v_link,
           jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                              'brand_id', v_brand, 'kind', 'approved')
    from public.profiles pr
    where pr.role = 'bob' and pr.id <> auth.uid();
  end if;
end;
$$;
