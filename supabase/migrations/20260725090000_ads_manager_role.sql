-- =========================================================
-- Afflix Core — Ads Manager role (view-only APC + GMV Max editor)
--
-- New role 'ads_manager': sees their assigned brands like an APC —
-- Brands list, Brand Detail (Resources / Reporting / GMV Max / Sample
-- Seeding / Products / Paid Collab), global Resources, Reporting pages —
-- but everything is READ-ONLY except:
--   • GMV Max (Brand Detail → GMV Max tab): full edit on their brands.
--   • Paid Collab video "Authorised" toggle (set_handler_creator_video_auth).
-- They can also comment (report + resource comments), mirroring APC.
--
-- Deliberately NOT internal staff (is_internal_staff / is_chat_staff is
-- untouched): no Chats, no Tasks, no announcement. And deliberately NOT
-- added to user_has_brand_access() — that helper backs `for all` (write)
-- policies on brand_products and the legacy paid_creator_* tables, and it
-- gates set_handler_creator_monthly; widening it would break view-only.
-- Instead: parallel per-table read policies via ads_manager_has_brand(),
-- exactly like the Team Lead pattern (20260616).
--
-- Assignment: new table ads_manager_brands (Bob-managed, no exclusivity —
-- a brand can have an Ads Manager alongside its APC / Team Lead).
-- 100% ADDITIVE: no existing table / policy / helper is rewritten except
-- set_handler_creator_video_auth (widened with the ads-manager clause).
-- =========================================================

-- ---------- 1. Assignment table ----------

create table if not exists public.ads_manager_brands (
  ads_manager_id uuid not null references public.profiles(id) on delete cascade,
  brand_id       uuid not null references public.brands(id)   on delete cascade,
  assigned_at    timestamptz not null default now(),
  primary key (ads_manager_id, brand_id)
);
create index if not exists amb_manager_idx on public.ads_manager_brands(ads_manager_id);
create index if not exists amb_brand_idx   on public.ads_manager_brands(brand_id);
alter table public.ads_manager_brands enable row level security;

drop policy if exists "amb bob all" on public.ads_manager_brands;
create policy "amb bob all" on public.ads_manager_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "amb self read" on public.ads_manager_brands;
create policy "amb self read" on public.ads_manager_brands
  for select using (ads_manager_id = auth.uid());

-- ---------- 2. Helpers (SECURITY DEFINER → no RLS recursion) ----------

create or replace function public.is_ads_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ads_manager');
$$;

-- Is this brand assigned to the current Ads Manager?
create or replace function public.ads_manager_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ads_manager_brands amb
    where amb.ads_manager_id = auth.uid() and amb.brand_id = b_id
  );
$$;

-- ---------- 3. RLS: brands (read their assigned brands; no update) ----------

drop policy if exists "brands ads_manager read" on public.brands;
create policy "brands ads_manager read" on public.brands
  for select using (public.ads_manager_has_brand(id));

-- ---------- 4. RLS: READ-ONLY brand-detail data (parallel to APC/Team Lead) ----------

-- weekly_reports (view only — no insert/update/delete)
drop policy if exists "wr ads_manager read" on public.weekly_reports;
create policy "wr ads_manager read" on public.weekly_reports
  for select using (public.ads_manager_has_brand(brand_id));

-- monthly_reports
drop policy if exists "mr ads_manager read" on public.monthly_reports;
create policy "mr ads_manager read" on public.monthly_reports
  for select using (public.ads_manager_has_brand(brand_id));

-- brand_report_settings (needed to render the reporting lists)
drop policy if exists "brs ads_manager read" on public.brand_report_settings;
create policy "brs ads_manager read" on public.brand_report_settings
  for select using (public.ads_manager_has_brand(brand_id));

-- sample seeding (view only)
drop policy if exists "bsp ads_manager read" on public.brand_samples_products;
create policy "bsp ads_manager read" on public.brand_samples_products
  for select using (public.ads_manager_has_brand(brand_id));

drop policy if exists "bspd ads_manager read" on public.brand_samples_periods;
create policy "bspd ads_manager read" on public.brand_samples_periods
  for select using (public.ads_manager_has_brand(brand_id));

drop policy if exists "bsd ads_manager read" on public.brand_samples_daily;
create policy "bsd ads_manager read" on public.brand_samples_daily
  for select using (public.ads_manager_has_brand(brand_id));

drop policy if exists "bswg ads_manager read" on public.brand_samples_weekly_gmv;
create policy "bswg ads_manager read" on public.brand_samples_weekly_gmv
  for select using (public.ads_manager_has_brand(brand_id));

-- products (view only — the existing "bp scoped" policy is for-all via
-- user_has_brand_access, which we deliberately do NOT widen)
drop policy if exists "bp ads_manager read" on public.brand_products;
create policy "bp ads_manager read" on public.brand_products
  for select using (public.ads_manager_has_brand(brand_id));

-- resources: general + their brands, READ only
drop policy if exists "resources ads_manager read" on public.resources;
create policy "resources ads_manager read" on public.resources
  for select using (
    public.is_ads_manager()
    and (scope = 'general' or public.ads_manager_has_brand(brand_id))
  );

drop policy if exists "rf ads_manager read" on public.resource_folders;
create policy "rf ads_manager read" on public.resource_folders
  for select using (
    public.is_ads_manager()
    and (scope = 'general' or public.ads_manager_has_brand(brand_id))
  );

-- paid collab (handler workspace data behind the Brand Detail tab — view only)
drop policy if exists "hcbm ads_manager read" on public.handler_collab_brand_months;
create policy "hcbm ads_manager read" on public.handler_collab_brand_months
  for select using (public.ads_manager_has_brand(brand_id));

drop policy if exists "hcc ads_manager read" on public.handler_collab_creators;
create policy "hcc ads_manager read" on public.handler_collab_creators
  for select using (public.ads_manager_has_brand(brand_id));

-- ---------- 5. Comments (read + write, mirroring APC — communication, not data) ----------
-- author_type check constraints only allow ('client','bob','apc'); the front-end
-- already posts every non-Bob staff comment as 'apc' (Team Leads included).

drop policy if exists "rc ads_manager read" on public.report_comments;
create policy "rc ads_manager read" on public.report_comments
  for select using (
    exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id
        and public.ads_manager_has_brand(wr.brand_id)
    )
  );

drop policy if exists "rc ads_manager insert" on public.report_comments;
create policy "rc ads_manager insert" on public.report_comments
  for insert with check (
    exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id
        and public.ads_manager_has_brand(wr.brand_id)
    )
  );

drop policy if exists "rsc ads_manager read" on public.resource_comments;
create policy "rsc ads_manager read" on public.resource_comments
  for select using (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (
          (r.scope = 'general' and public.is_ads_manager())
          or public.ads_manager_has_brand(r.brand_id)
        )
    )
  );

drop policy if exists "rsc ads_manager insert" on public.resource_comments;
create policy "rsc ads_manager insert" on public.resource_comments
  for insert with check (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (
          (r.scope = 'general' and public.is_ads_manager())
          or public.ads_manager_has_brand(r.brand_id)
        )
    )
  );

-- ---------- 6. GMV Max: FULL EDIT on their brands (the role's edit surface) ----------

drop policy if exists "bgmm ads_manager all" on public.brand_gmv_max_monthly;
create policy "bgmm ads_manager all" on public.brand_gmv_max_monthly
  for all using (public.ads_manager_has_brand(brand_id))
  with check (public.ads_manager_has_brand(brand_id));

drop policy if exists "bgmw ads_manager all" on public.brand_gmv_max_weekly;
create policy "bgmw ads_manager all" on public.brand_gmv_max_weekly
  for all using (public.ads_manager_has_brand(brand_id))
  with check (public.ads_manager_has_brand(brand_id));

-- ---------- 7. Paid Collab video "Authorised" toggle ----------
-- Re-create the RPC with an ads-manager clause. Identical to 20260629 plus the
-- `is_ads_manager() and ads_manager_has_brand` arm. set_handler_creator_monthly
-- (the editable Performance GMV matrix) is intentionally NOT widened — Ads
-- Managers view paid-collab performance read-only.

create or replace function public.set_handler_creator_video_auth(
  p_creator uuid, p_index int, p_auth boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  codes jsonb;
begin
  select brand_id, video_codes into b_id, codes
  from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;

  if not (public.writes_paid_collab_brand(b_id)
          or (public.is_internal_staff() and public.user_has_brand_access(b_id))
          or (public.is_ads_manager() and public.ads_manager_has_brand(b_id))) then
    raise exception 'not allowed';
  end if;

  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  if p_index < 0 or p_index >= jsonb_array_length(codes) then raise exception 'bad video index'; end if;

  codes := jsonb_set(codes, array[p_index::text, 'auth'], to_jsonb(coalesce(p_auth, false)), true);
  update public.handler_collab_creators set video_codes = codes where id = p_creator;
end;
$$;

revoke all on function public.set_handler_creator_video_auth(uuid, int, boolean) from public;
grant execute on function public.set_handler_creator_video_auth(uuid, int, boolean) to authenticated;

-- ---------- 8. Bob: replace an Ads Manager's brands + notify ----------
-- Mirrors set_apc_brands (20260620) minus the one-brand→one-APC rule: an Ads
-- Manager coexists with the brand's APC / Team Lead.

create or replace function public.set_ads_manager_brands(p_manager uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
begin
  if not public.is_bob() then raise exception 'Only Bob can set an Ads Manager''s brands'; end if;
  if (select role from public.profiles where id = p_manager) <> 'ads_manager' then
    raise exception 'Target is not an Ads Manager';
  end if;

  -- Brands newly added (for the notification), computed before the rewrite.
  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.ads_manager_brands where ads_manager_id = p_manager and brand_id = b);

  delete from public.ads_manager_brands where ads_manager_id = p_manager;
  if array_length(v_ids, 1) > 0 then
    insert into public.ads_manager_brands (ads_manager_id, brand_id) select p_manager, unnest(v_ids);
  end if;

  if v_added is not null and array_length(v_added, 1) > 0 then
    select string_agg(name, ', ' order by name) into v_names from public.brands where id = any(v_added);
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_manager, 'brand_assignment',
            'New brand' || case when array_length(v_added,1) > 1 then 's' else '' end || ' assigned to you',
            coalesce(v_names, 'A brand'),
            '/brands',
            jsonb_build_object('brand_ids', to_jsonb(v_added), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_ads_manager_brands(uuid, uuid[]) from public;
grant execute on function public.set_ads_manager_brands(uuid, uuid[]) to authenticated;
