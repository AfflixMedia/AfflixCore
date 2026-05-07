-- =========================================================
-- Afflix Core - Monthly Reports
-- Mirrors weekly_reports infra (RLS, thread/approval polymorphism, presets)
-- =========================================================

-- 1. monthly_reports table — one row per (brand × month YYYY-MM)
create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  month text not null,                     -- 'YYYY-MM'
  status text not null default 'draft',    -- 'draft' | 'submitted'
  content jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, month)
);

create index if not exists monthly_reports_brand_idx     on public.monthly_reports(brand_id);
create index if not exists monthly_reports_brand_month   on public.monthly_reports(brand_id, month);
create index if not exists monthly_reports_is_shared_idx on public.monthly_reports(brand_id) where is_shared = true;

drop trigger if exists mr_updated_at on public.monthly_reports;
create trigger mr_updated_at
  before update on public.monthly_reports
  for each row execute function public.set_updated_at();

alter table public.monthly_reports enable row level security;

drop policy if exists "mr bob all" on public.monthly_reports;
create policy "mr bob all" on public.monthly_reports
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "mr apc read" on public.monthly_reports;
create policy "mr apc read" on public.monthly_reports
  for select using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "mr apc write" on public.monthly_reports;
create policy "mr apc write" on public.monthly_reports
  for all using (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = monthly_reports.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 2. report_comments / report_approval_decisions become polymorphic
--    via a `report_type` column. Existing rows = 'weekly'.
alter table public.report_comments
  add column if not exists report_type text not null default 'weekly';
alter table public.report_approval_decisions
  add column if not exists report_type text not null default 'weekly';

create index if not exists report_comments_type_id
  on public.report_comments(report_type, report_id);
create index if not exists report_approval_decisions_type_id
  on public.report_approval_decisions(report_type, report_id);

-- 3. Section presets — separate library for monthly reports
create table if not exists public.monthly_section_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  payload jsonb not null,                 -- a CustomSection snapshot OR a section_id replacement
  kind text not null default 'custom',    -- 'custom' | 'standard'
  section_id text,                        -- null for custom; standard sec id for 'standard'
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.monthly_section_presets enable row level security;

drop policy if exists "msp read" on public.monthly_section_presets;
create policy "msp read" on public.monthly_section_presets
  for select using (auth.uid() is not null);

drop policy if exists "msp insert" on public.monthly_section_presets;
create policy "msp insert" on public.monthly_section_presets
  for insert with check (auth.uid() is not null);

drop policy if exists "msp delete own or bob" on public.monthly_section_presets;
create policy "msp delete own or bob" on public.monthly_section_presets
  for delete using (auth.uid() = created_by or public.is_bob());

-- 4. Storage bucket for inline report images (Total Sales + each long-text section)
insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', true)
on conflict (id) do nothing;

-- Anyone can read (public bucket); only authed staff can upload
drop policy if exists "report-images read" on storage.objects;
create policy "report-images read" on storage.objects
  for select using (bucket_id = 'report-images');

drop policy if exists "report-images authed insert" on storage.objects;
create policy "report-images authed insert" on storage.objects
  for insert with check (bucket_id = 'report-images' and auth.uid() is not null);

drop policy if exists "report-images authed update" on storage.objects;
create policy "report-images authed update" on storage.objects
  for update using (bucket_id = 'report-images' and auth.uid() is not null);

drop policy if exists "report-images authed delete" on storage.objects;
create policy "report-images authed delete" on storage.objects
  for delete using (bucket_id = 'report-images' and auth.uid() is not null);
