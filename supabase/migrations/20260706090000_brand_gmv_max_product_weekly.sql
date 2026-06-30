-- =========================================================
-- Per-product weekly GMV Max entries.
-- APCs enter ad spend / orders / GMV per product per week on the brand's
-- GMV Max tab; the weekly report's §11.2 (Ad Spend by Product) auto-fetches
-- them by matching week_start to the brand's weekly-report cycle.
-- Mirrors brand_gmv_max_weekly (same RLS model).
-- =========================================================

create table if not exists public.brand_gmv_max_product_weekly (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  week_start date not null,
  week_end date not null,
  product text not null default '',
  product_id text not null default '',
  spend numeric(14,2) not null default 0,
  orders integer not null default 0,
  gmv numeric(14,2) not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bgmpw_brand_idx on public.brand_gmv_max_product_weekly(brand_id);
create index if not exists bgmpw_brand_week_idx on public.brand_gmv_max_product_weekly(brand_id, week_start);

drop trigger if exists bgmpw_updated_at on public.brand_gmv_max_product_weekly;
create trigger bgmpw_updated_at
  before update on public.brand_gmv_max_product_weekly
  for each row execute function public.set_updated_at();

alter table public.brand_gmv_max_product_weekly enable row level security;

-- Bob: full access
drop policy if exists "bgmpw bob all" on public.brand_gmv_max_product_weekly;
create policy "bgmpw bob all" on public.brand_gmv_max_product_weekly
  for all using (public.is_bob()) with check (public.is_bob());

-- APC assigned to the brand: read
drop policy if exists "bgmpw apc read" on public.brand_gmv_max_product_weekly;
create policy "bgmpw apc read" on public.brand_gmv_max_product_weekly
  for select using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brand_gmv_max_product_weekly.brand_id and ab.apc_id = auth.uid()
    )
  );

-- APC with can_manage_gmv_max assigned to the brand: write
drop policy if exists "bgmpw apc write" on public.brand_gmv_max_product_weekly;
create policy "bgmpw apc write" on public.brand_gmv_max_product_weekly
  for all using (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_product_weekly.brand_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_manage_gmv_max = true
        and ab.brand_id = brand_gmv_max_product_weekly.brand_id
    )
  );

-- Team Lead with the brand: full access
drop policy if exists "bgmpw team_lead all" on public.brand_gmv_max_product_weekly;
create policy "bgmpw team_lead all" on public.brand_gmv_max_product_weekly
  for all using (public.team_lead_has_brand(brand_id))
  with check (public.team_lead_has_brand(brand_id));
