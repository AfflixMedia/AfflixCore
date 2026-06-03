-- =========================================================
-- Afflix Core - Brand Sample Seeding
-- Per-brand product list, monthly goal, daily approval entries,
-- and per-week affiliate GMV. Bob full access; assigned APCs read+write.
-- =========================================================

-- 1. Tracked products per brand
create table if not exists public.brand_samples_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  external_product_id text,
  name text not null,
  monthly_goal int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists bsp_brand_idx on public.brand_samples_products(brand_id);

alter table public.brand_samples_products enable row level security;

drop policy if exists "bsp bob all" on public.brand_samples_products;
create policy "bsp bob all" on public.brand_samples_products
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bsp apc all" on public.brand_samples_products;
create policy "bsp apc all" on public.brand_samples_products
  for all using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_products.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_products.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 2. Monthly goal per brand
create table if not exists public.brand_samples_periods (
  brand_id uuid not null references public.brands(id) on delete cascade,
  month text not null,                          -- 'YYYY-MM'
  total_goal int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (brand_id, month)
);

drop trigger if exists bspd_updated_at on public.brand_samples_periods;
create trigger bspd_updated_at
  before update on public.brand_samples_periods
  for each row execute function public.set_updated_at();

alter table public.brand_samples_periods enable row level security;

drop policy if exists "bspd bob all" on public.brand_samples_periods;
create policy "bspd bob all" on public.brand_samples_periods
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bspd apc all" on public.brand_samples_periods;
create policy "bspd apc all" on public.brand_samples_periods
  for all using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_periods.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_periods.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 3. Daily entries (one row per brand per date).
--    product_counts: jsonb map of { "<product_uuid>": count }.
create table if not exists public.brand_samples_daily (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  entry_date date not null,
  new_videos int,
  daily_sps numeric(3,1),
  reason_of_drop text,
  others_count int not null default 0,
  product_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, entry_date)
);

create index if not exists bsd_brand_date_idx
  on public.brand_samples_daily(brand_id, entry_date);

drop trigger if exists bsd_updated_at on public.brand_samples_daily;
create trigger bsd_updated_at
  before update on public.brand_samples_daily
  for each row execute function public.set_updated_at();

alter table public.brand_samples_daily enable row level security;

drop policy if exists "bsd bob all" on public.brand_samples_daily;
create policy "bsd bob all" on public.brand_samples_daily
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bsd apc all" on public.brand_samples_daily;
create policy "bsd apc all" on public.brand_samples_daily
  for all using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_daily.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_daily.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 4. Weekly affiliate GMV per brand-month (week_index 1..5 = 1-7,8-14,15-21,22-28,29-end)
create table if not exists public.brand_samples_weekly_gmv (
  brand_id uuid not null references public.brands(id) on delete cascade,
  month text not null,                          -- 'YYYY-MM'
  week_index int not null check (week_index between 1 and 5),
  affiliate_gmv numeric(14,2),
  updated_at timestamptz not null default now(),
  primary key (brand_id, month, week_index)
);

drop trigger if exists bswg_updated_at on public.brand_samples_weekly_gmv;
create trigger bswg_updated_at
  before update on public.brand_samples_weekly_gmv
  for each row execute function public.set_updated_at();

alter table public.brand_samples_weekly_gmv enable row level security;

drop policy if exists "bswg bob all" on public.brand_samples_weekly_gmv;
create policy "bswg bob all" on public.brand_samples_weekly_gmv
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "bswg apc all" on public.brand_samples_weekly_gmv;
create policy "bswg apc all" on public.brand_samples_weekly_gmv
  for all using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_weekly_gmv.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_samples_weekly_gmv.brand_id and ab.apc_id = auth.uid()
    )
  );
