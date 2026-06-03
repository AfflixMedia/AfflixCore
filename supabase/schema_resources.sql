-- =========================================================
-- Afflix Core - Resources migration
-- Run AFTER schema.sql, schema_apc.sql, schema_weekly.sql, schema_clients_share.sql
-- =========================================================

-- 1. Resources table — google docs, sheets, drive, arbitrary URLs
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  description text,
  scope text not null default 'general' check (scope in ('general','brand')),
  brand_id uuid references public.brands(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scope_brand_consistency check (
    (scope = 'general' and brand_id is null)
    or (scope = 'brand' and brand_id is not null)
  )
);

create index if not exists resources_brand_idx on public.resources(brand_id);
create index if not exists resources_scope_idx on public.resources(scope);

drop trigger if exists resources_updated_at on public.resources;
create trigger resources_updated_at
  before update on public.resources
  for each row execute function public.set_updated_at();

-- 2. RLS
alter table public.resources enable row level security;

-- Bob: full access
drop policy if exists "resources bob all" on public.resources;
create policy "resources bob all" on public.resources
  for all using (public.is_bob()) with check (public.is_bob());

-- APC: read general + their assigned brand resources
drop policy if exists "resources apc read" on public.resources;
create policy "resources apc read" on public.resources
  for select using (
    scope = 'general'
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 3. Share links: optionally include resource ids
alter table public.report_share_links
  add column if not exists resource_ids uuid[] not null default '{}'::uuid[];
