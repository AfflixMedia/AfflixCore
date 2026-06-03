-- =========================================================
-- Afflix Core - Supabase schema (run in Supabase SQL Editor)
-- =========================================================

-- 1. Profiles table (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending',
  created_at timestamptz not null default now()
);

-- 2. Trigger: auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'pending');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Brands table
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null,
  last_month_gmv numeric(14,2) not null default 0,
  tier_unlimited boolean not null default false,
  tier_value integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists brands_updated_at on public.brands;
create trigger brands_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

-- 4. Helper: is current user Bob?
create or replace function public.is_bob()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'bob');
$$;

-- 5. Row Level Security
alter table public.profiles enable row level security;
alter table public.brands   enable row level security;

-- profiles: each user can read/update their own row; Bob can read all
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (auth.uid() = id or public.is_bob());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (auth.uid() = id);

-- brands: any authenticated user can read; only Bob can write
drop policy if exists "brands read auth" on public.brands;
create policy "brands read auth" on public.brands
  for select using (auth.role() = 'authenticated');

drop policy if exists "brands bob insert" on public.brands;
create policy "brands bob insert" on public.brands
  for insert with check (public.is_bob());

drop policy if exists "brands bob update" on public.brands;
create policy "brands bob update" on public.brands
  for update using (public.is_bob());

drop policy if exists "brands bob delete" on public.brands;
create policy "brands bob delete" on public.brands
  for delete using (public.is_bob());

-- =========================================================
-- AFTER Bob signs up via the app, promote him with:
--   update public.profiles set role = 'bob'
--   where email = 'Bob@afflixmedia.com';
-- =========================================================
