-- =========================================================
-- Afflix Core - Weekly Reports migration
-- Run AFTER schema.sql and schema_apc.sql
-- =========================================================

-- 1. Per-brand anchor: defines the start of the brand's weekly reporting cycle.
--    Set once (first time any user creates a report for that brand) and stays.
create table if not exists public.brand_report_settings (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  weekly_anchor date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Weekly reports
create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  brand_id   uuid not null references public.brands(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  week_start date not null,
  week_end   date not null,
  week_number int not null,         -- 1-based; 1 == anchor week
  status text not null default 'draft',  -- draft | submitted
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, week_start)
);

create index if not exists weekly_reports_brand_idx   on public.weekly_reports(brand_id);
create index if not exists weekly_reports_creator_idx on public.weekly_reports(created_by);
create index if not exists weekly_reports_week_idx    on public.weekly_reports(week_start);

drop trigger if exists weekly_reports_updated_at on public.weekly_reports;
create trigger weekly_reports_updated_at
  before update on public.weekly_reports
  for each row execute function public.set_updated_at();

drop trigger if exists brand_report_settings_updated_at on public.brand_report_settings;
create trigger brand_report_settings_updated_at
  before update on public.brand_report_settings
  for each row execute function public.set_updated_at();

-- 3. RLS
alter table public.brand_report_settings enable row level security;
alter table public.weekly_reports        enable row level security;

-- brand_report_settings: anyone who can see the brand can read; APC of brand or Bob can write
drop policy if exists "brs read scoped" on public.brand_report_settings;
create policy "brs read scoped" on public.brand_report_settings
  for select using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "brs write scoped" on public.brand_report_settings;
create policy "brs write scoped" on public.brand_report_settings
  for all using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  ) with check (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = brand_report_settings.brand_id and ab.apc_id = auth.uid())
  );

-- weekly_reports: Bob sees all; APC sees only their brands' reports.
drop policy if exists "wr read scoped" on public.weekly_reports;
create policy "wr read scoped" on public.weekly_reports
  for select using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "wr insert scoped" on public.weekly_reports;
create policy "wr insert scoped" on public.weekly_reports
  for insert with check (
    created_by = auth.uid() and (
      public.is_bob()
      or exists (select 1 from public.apc_brands ab
                 where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
    )
  );

drop policy if exists "wr update scoped" on public.weekly_reports;
create policy "wr update scoped" on public.weekly_reports
  for update using (
    public.is_bob()
    or exists (select 1 from public.apc_brands ab
               where ab.brand_id = weekly_reports.brand_id and ab.apc_id = auth.uid())
  );

drop policy if exists "wr delete bob" on public.weekly_reports;
create policy "wr delete bob" on public.weekly_reports
  for delete using (public.is_bob());
