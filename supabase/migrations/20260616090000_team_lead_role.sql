-- =========================================================
-- Afflix Core — Team Lead role + hierarchy (Phase 1)
--
-- Adds a middle-management role between Bob and APC:
--     Bob (boss) ─ Team Lead ─ APC
--
-- • Bob assigns brands to a Team Lead (team_lead_brands).
-- • A Team Lead re-assigns a SUBSET of those brands to their APCs (apc_brands),
--   and can add / edit APCs they own (profiles.team_lead_id).
-- • A Team Lead has APC-level data access to their brands (reporting, gmv max,
--   samples, products, resources) — but NOT paid collab, billing, or payments.
-- • A Team Lead canNOT create another Team Lead and canNOT delete APCs.
--
-- 100% ADDITIVE: new column, new table, new helpers, new policies. No existing
-- table / column / policy is dropped or rewritten, so current Bob & APC
-- behaviour and all existing data are untouched.
-- =========================================================

-- ---------- 1. Schema additions ----------

-- Which Team Lead owns this APC (null = directly under Bob, legacy behaviour).
alter table public.profiles
  add column if not exists team_lead_id uuid references public.profiles(id) on delete set null;
create index if not exists profiles_team_lead_idx on public.profiles(team_lead_id);

-- Bob → Team Lead brand grant. Separate from apc_brands so a Team Lead's brand
-- access stays out of the paid-collab helper user_has_brand_access().
create table if not exists public.team_lead_brands (
  team_lead_id uuid not null references public.profiles(id) on delete cascade,
  brand_id     uuid not null references public.brands(id)   on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (team_lead_id, brand_id)
);
create index if not exists tlb_lead_idx  on public.team_lead_brands(team_lead_id);
create index if not exists tlb_brand_idx on public.team_lead_brands(brand_id);
alter table public.team_lead_brands enable row level security;

-- ---------- 2. Helpers (SECURITY DEFINER → no RLS recursion) ----------

create or replace function public.is_team_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'team_lead');
$$;

-- Does the current Team Lead hold a Bob-granted assignment for this brand?
create or replace function public.team_lead_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_lead_brands tlb
    where tlb.team_lead_id = auth.uid() and tlb.brand_id = b_id
  );
$$;

-- Does the current Team Lead own this APC profile?
create or replace function public.manages_apc(apc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = apc and p.role = 'apc' and p.team_lead_id = auth.uid()
  );
$$;

-- Team Leads count as internal staff (chat, etc.). Re-create with the extra role.
create or replace function public.is_internal_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('bob', 'team_lead', 'apc', 'paid_collab_handler')
  );
$$;

-- ---------- 3. RLS: team_lead_brands ----------

drop policy if exists "tlb bob all" on public.team_lead_brands;
create policy "tlb bob all" on public.team_lead_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "tlb self read" on public.team_lead_brands;
create policy "tlb self read" on public.team_lead_brands
  for select using (team_lead_id = auth.uid());

-- ---------- 4. RLS: profiles (Team Lead manages their own APCs) ----------

-- Read the APC rows they own (their own row is covered by "profiles self read").
drop policy if exists "profiles team_lead read apcs" on public.profiles;
create policy "profiles team_lead read apcs" on public.profiles
  for select using (role = 'apc' and team_lead_id = auth.uid());

-- Edit those APC rows. WITH CHECK pins role='apc' + ownership so a Team Lead
-- can't promote an APC, steal another lead's APC, or re-parent it.
drop policy if exists "profiles team_lead update apcs" on public.profiles;
create policy "profiles team_lead update apcs" on public.profiles
  for update
  using (role = 'apc' and team_lead_id = auth.uid())
  with check (role = 'apc' and team_lead_id = auth.uid());

-- ---------- 5. RLS: apc_brands (Team Lead assigns their brands to their APCs) ----------

drop policy if exists "apc_brands team_lead read" on public.apc_brands;
create policy "apc_brands team_lead read" on public.apc_brands
  for select using (public.manages_apc(apc_id));

drop policy if exists "apc_brands team_lead insert" on public.apc_brands;
create policy "apc_brands team_lead insert" on public.apc_brands
  for insert with check (public.manages_apc(apc_id) and public.team_lead_has_brand(brand_id));

drop policy if exists "apc_brands team_lead delete" on public.apc_brands;
create policy "apc_brands team_lead delete" on public.apc_brands
  for delete using (public.manages_apc(apc_id) and public.team_lead_has_brand(brand_id));

-- ---------- 6. RLS: brands (see + edit their assigned brands) ----------

drop policy if exists "brands team_lead read" on public.brands;
create policy "brands team_lead read" on public.brands
  for select using (public.team_lead_has_brand(id));

drop policy if exists "brands team_lead update" on public.brands;
create policy "brands team_lead update" on public.brands
  for update using (public.team_lead_has_brand(id))
  with check (public.team_lead_has_brand(id));

-- ---------- 7. RLS: brand-detail data tables (parallel to existing APC policies) ----------
-- Pattern: add a Team Lead policy scoped by team_lead_has_brand(<brand_id>).
-- Reports get select/insert/update (no delete — delete stays Bob-only, matching APC).
-- Everything else mirrors the APC `for all` grant. Paid-collab / billing / payments
-- tables intentionally get NO Team Lead policy.

-- weekly_reports
drop policy if exists "wr team_lead read" on public.weekly_reports;
create policy "wr team_lead read" on public.weekly_reports
  for select using (public.team_lead_has_brand(brand_id));
drop policy if exists "wr team_lead insert" on public.weekly_reports;
create policy "wr team_lead insert" on public.weekly_reports
  for insert with check (created_by = auth.uid() and public.team_lead_has_brand(brand_id));
drop policy if exists "wr team_lead update" on public.weekly_reports;
create policy "wr team_lead update" on public.weekly_reports
  for update using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_report_settings
drop policy if exists "brs team_lead all" on public.brand_report_settings;
create policy "brs team_lead all" on public.brand_report_settings
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- monthly_reports
drop policy if exists "mr team_lead all" on public.monthly_reports;
create policy "mr team_lead all" on public.monthly_reports
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_gmv_max_monthly
drop policy if exists "bgmm team_lead all" on public.brand_gmv_max_monthly;
create policy "bgmm team_lead all" on public.brand_gmv_max_monthly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_gmv_max_weekly
drop policy if exists "bgmw team_lead all" on public.brand_gmv_max_weekly;
create policy "bgmw team_lead all" on public.brand_gmv_max_weekly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_samples_products
drop policy if exists "bsp team_lead all" on public.brand_samples_products;
create policy "bsp team_lead all" on public.brand_samples_products
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_samples_periods
drop policy if exists "bspd team_lead all" on public.brand_samples_periods;
create policy "bspd team_lead all" on public.brand_samples_periods
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_samples_daily
drop policy if exists "bsd team_lead all" on public.brand_samples_daily;
create policy "bsd team_lead all" on public.brand_samples_daily
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_samples_weekly_gmv
drop policy if exists "bswg team_lead all" on public.brand_samples_weekly_gmv;
create policy "bswg team_lead all" on public.brand_samples_weekly_gmv
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- brand_products (existing policy uses user_has_brand_access; add a parallel one
-- so Team Leads get product access WITHOUT widening the paid-collab helper).
drop policy if exists "bp team_lead all" on public.brand_products;
create policy "bp team_lead all" on public.brand_products
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));

-- resources: general (read+write like staff) + their brand scope
drop policy if exists "resources team_lead general all" on public.resources;
create policy "resources team_lead general all" on public.resources
  for all using (scope = 'general' and public.is_team_lead())
  with check (scope = 'general' and public.is_team_lead());
drop policy if exists "resources team_lead brand all" on public.resources;
create policy "resources team_lead brand all" on public.resources
  for all using (scope = 'brand' and public.team_lead_has_brand(brand_id))
  with check (scope = 'brand' and public.team_lead_has_brand(brand_id));

-- resource_folders: general + their brand scope
drop policy if exists "rf team_lead general all" on public.resource_folders;
create policy "rf team_lead general all" on public.resource_folders
  for all using (scope = 'general' and public.is_team_lead())
  with check (scope = 'general' and public.is_team_lead());
drop policy if exists "rf team_lead brand all" on public.resource_folders;
create policy "rf team_lead brand all" on public.resource_folders
  for all using (scope = 'brand' and public.team_lead_has_brand(brand_id))
  with check (scope = 'brand' and public.team_lead_has_brand(brand_id));

-- =========================================================
-- After applying, promote the first Team Lead in SQL, e.g.:
--   update public.profiles set role = 'team_lead',
--          can_edit_brands = true, can_manage_gmv_max = true
--   where email = 'lead@afflixmedia.com';
-- Then assign brands: insert into public.team_lead_brands(team_lead_id, brand_id) ...
-- =========================================================
