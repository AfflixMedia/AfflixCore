-- =========================================================
-- Afflix Core — Internal report review (Phase 2)
--
-- APC submits a weekly/monthly report for review → it routes to the Team Lead(s)
-- of that brand, who Accept or Reject it. On accept, Bob sees it flagged Reviewed.
-- Brands with no Team Lead skip review (submit is blocked with a clear message).
--
-- ADDITIVE: new columns (defaults) + helper + two SECURITY DEFINER RPCs. The Team
-- Lead's UPDATE on these review columns is already permitted by the Phase 1
-- "wr team_lead update" / "mr team_lead all" policies; the RPCs run as definer so
-- they can also fan out notifications (which have no INSERT policy) and read across
-- rows safely.
-- =========================================================

-- ---------- 1. Review columns ----------
alter table public.weekly_reports
  add column if not exists review_status text not null default 'none',
  add column if not exists reviewed_by   uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_note   text;

alter table public.monthly_reports
  add column if not exists review_status text not null default 'none',
  add column if not exists reviewed_by   uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at   timestamptz,
  add column if not exists review_note   text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_reports_review_status_ck') then
    alter table public.weekly_reports
      add constraint weekly_reports_review_status_ck
      check (review_status in ('none','submitted','approved','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'monthly_reports_review_status_ck') then
    alter table public.monthly_reports
      add constraint monthly_reports_review_status_ck
      check (review_status in ('none','submitted','approved','rejected'));
  end if;
end $$;

-- ---------- 2. Helper: does this brand have a Team Lead to review? ----------
-- SECURITY DEFINER so an APC (who can't read others' team_lead_brands rows) can
-- still tell whether a reviewer exists.
create or replace function public.brand_has_team_lead(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_lead_brands where brand_id = b_id);
$$;
grant execute on function public.brand_has_team_lead(uuid) to authenticated;

-- ---------- 3. RPC: APC submits a report for review ----------
create or replace function public.submit_report_for_review(p_kind text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_brand uuid; v_name text; v_label text; v_link text;
begin
  if p_kind not in ('weekly','monthly') then raise exception 'invalid report kind'; end if;

  if p_kind = 'weekly' then
    select brand_id into v_brand from public.weekly_reports where id = p_id;
  else
    select brand_id into v_brand from public.monthly_reports where id = p_id;
  end if;
  if v_brand is null then raise exception 'report not found'; end if;

  -- Submitter must be an APC assigned to the brand (Bob may submit too).
  if not public.is_bob()
     and not exists (select 1 from public.apc_brands where brand_id = v_brand and apc_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  -- A Team Lead must exist to receive the review.
  if not exists (select 1 from public.team_lead_brands where brand_id = v_brand) then
    raise exception 'No Team Lead is assigned to review this brand''s reports';
  end if;

  if p_kind = 'weekly' then
    update public.weekly_reports
      set review_status = 'submitted', reviewed_by = null, reviewed_at = null, review_note = null
      where id = p_id;
    v_link := '/reporting/weekly/' || p_id::text;
  else
    update public.monthly_reports
      set review_status = 'submitted', reviewed_by = null, reviewed_at = null, review_note = null
      where id = p_id;
    v_link := '/reporting/monthly/' || p_id::text;
  end if;

  select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = auth.uid();
  select name into v_label from public.brands where id = v_brand;

  insert into public.notifications (user_id, type, title, body, link, payload)
  select tlb.team_lead_id, 'report_review',
         coalesce(v_name,'An APC') || ' submitted a report for review',
         coalesce(v_label,'A brand') || ' — ' || p_kind || ' report',
         v_link,
         jsonb_build_object('report_id', p_id, 'report_type', p_kind,
                            'brand_id', v_brand, 'kind', 'submitted')
  from public.team_lead_brands tlb
  where tlb.brand_id = v_brand;
end;
$$;
revoke all on function public.submit_report_for_review(text, uuid) from public;
grant execute on function public.submit_report_for_review(text, uuid) to authenticated;

-- ---------- 4. RPC: Team Lead accepts / rejects a review ----------
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

  -- Reviewer must be the brand's Team Lead (Bob may override).
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
end;
$$;
revoke all on function public.decide_report_review(text, uuid, text, text) from public;
grant execute on function public.decide_report_review(text, uuid, text, text) to authenticated;
