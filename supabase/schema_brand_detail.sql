-- =========================================================
-- Afflix Core - Brand Detail page (Resources, Reporting, GMV Max, Paid Collab)
-- Run AFTER all prior schema files.
-- =========================================================

-- 1. Sharing toggles
alter table public.brands
  add column if not exists share_enabled boolean not null default false;

alter table public.weekly_reports
  add column if not exists is_shared boolean not null default false;

create index if not exists weekly_reports_is_shared_idx
  on public.weekly_reports(brand_id) where is_shared = true;

-- 2. Per-APC permission to manage GMV Max
alter table public.profiles
  add column if not exists can_manage_gmv_max boolean not null default false;

-- 3. GMV Max — monthly budget (Bob plans the month for each brand)
create table if not exists public.brand_gmv_max_monthly (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  month text not null,                          -- 'YYYY-MM'
  allocated_budget numeric(14,2) not null default 0,
  spend_to_date numeric(14,2) not null default 0,
  target_roi numeric(10,4) not null default 0,  -- monthly ROI goal (0 = none)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(brand_id, month)
);

create index if not exists bgmm_brand_idx on public.brand_gmv_max_monthly(brand_id);

drop trigger if exists bgmm_updated_at on public.brand_gmv_max_monthly;
create trigger bgmm_updated_at
  before update on public.brand_gmv_max_monthly
  for each row execute function public.set_updated_at();

alter table public.brand_gmv_max_monthly enable row level security;

drop policy if exists "bgmm bob all" on public.brand_gmv_max_monthly;
create policy "bgmm bob all" on public.brand_gmv_max_monthly
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bgmm apc read" on public.brand_gmv_max_monthly;
create policy "bgmm apc read" on public.brand_gmv_max_monthly
  for select using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_gmv_max_monthly.brand_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "bgmm apc write" on public.brand_gmv_max_monthly;
create policy "bgmm apc write" on public.brand_gmv_max_monthly
  for all using (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_monthly.brand_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_monthly.brand_id
    )
  );

-- 4. GMV Max — weekly entries (matches by week_start to weekly_reports for fetch)
create table if not exists public.brand_gmv_max_weekly (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  ad_spend numeric(14,2) not null default 0,
  roi numeric(10,4) not null default 0,
  orders integer not null default 0,
  cpo numeric(14,2) not null default 0,
  gmv numeric(14,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(brand_id, week_start)
);

create index if not exists bgmw_brand_idx on public.brand_gmv_max_weekly(brand_id);
create index if not exists bgmw_brand_week_idx on public.brand_gmv_max_weekly(brand_id, week_start);

drop trigger if exists bgmw_updated_at on public.brand_gmv_max_weekly;
create trigger bgmw_updated_at
  before update on public.brand_gmv_max_weekly
  for each row execute function public.set_updated_at();

alter table public.brand_gmv_max_weekly enable row level security;

drop policy if exists "bgmw bob all" on public.brand_gmv_max_weekly;
create policy "bgmw bob all" on public.brand_gmv_max_weekly
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bgmw apc read" on public.brand_gmv_max_weekly;
create policy "bgmw apc read" on public.brand_gmv_max_weekly
  for select using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_gmv_max_weekly.brand_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "bgmw apc write" on public.brand_gmv_max_weekly;
create policy "bgmw apc write" on public.brand_gmv_max_weekly
  for all using (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_weekly.brand_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_weekly.brand_id
    )
  );
