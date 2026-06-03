-- =========================================================
-- Afflix Core - Clients + Share Links migration
-- Run AFTER schema.sql, schema_apc.sql, schema_weekly.sql
-- =========================================================

-- 1. Clients table
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;

drop policy if exists "clients read auth" on public.clients;
create policy "clients read auth" on public.clients
  for select using (auth.role() = 'authenticated');

drop policy if exists "clients bob write" on public.clients;
create policy "clients bob write" on public.clients
  for all using (public.is_bob()) with check (public.is_bob());

-- 2. Add client_id to brands (nullable; existing brand.client text remains as fallback)
alter table public.brands add column if not exists client_id uuid references public.clients(id);
create index if not exists brands_client_id_idx on public.brands(client_id);

-- 3. Backfill: create clients from existing distinct brand.client text values, then link
insert into public.clients (name)
  select distinct trim(client) from public.brands
  where client is not null and trim(client) <> ''
on conflict (name) do nothing;

update public.brands b
  set client_id = c.id
  from public.clients c
  where b.client_id is null and trim(b.client) = c.name;

-- 4. Share links
create table if not exists public.report_share_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  label text,
  client_id uuid not null references public.clients(id) on delete cascade,
  brand_ids uuid[] not null default '{}'::uuid[],
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists rsl_token_idx on public.report_share_links(token);

alter table public.report_share_links enable row level security;

drop policy if exists "rsl bob all" on public.report_share_links;
create policy "rsl bob all" on public.report_share_links
  for all using (public.is_bob()) with check (public.is_bob());
