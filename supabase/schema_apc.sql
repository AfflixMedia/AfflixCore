-- =========================================================
-- Afflix Core - APC role migration (run AFTER schema.sql)
-- =========================================================

-- 1. APC <-> Brand assignment table
create table if not exists public.apc_brands (
  apc_id   uuid not null references public.profiles(id) on delete cascade,
  brand_id uuid not null references public.brands(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (apc_id, brand_id)
);

create index if not exists apc_brands_apc_idx   on public.apc_brands(apc_id);
create index if not exists apc_brands_brand_idx on public.apc_brands(brand_id);

alter table public.apc_brands enable row level security;

-- Bob: full access. APC: can read their own assignments.
drop policy if exists "apc_brands bob all" on public.apc_brands;
create policy "apc_brands bob all" on public.apc_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "apc_brands self read" on public.apc_brands;
create policy "apc_brands self read" on public.apc_brands
  for select using (apc_id = auth.uid());

-- 2. Profiles: Bob can update any profile (needed to manage APCs)
drop policy if exists "profiles bob update" on public.profiles;
create policy "profiles bob update" on public.profiles
  for update using (public.is_bob());

-- 3. Brands: APCs only see brands assigned to them (Bob still sees all)
drop policy if exists "brands read auth" on public.brands;
create policy "brands read scoped" on public.brands
  for select using (
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brands.id and ab.apc_id = auth.uid()
    )
  );
