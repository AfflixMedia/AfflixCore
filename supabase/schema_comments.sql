-- =========================================================
-- Afflix Core - Report Comments migration
-- Run AFTER schema.sql, schema_apc.sql, schema_weekly.sql, schema_clients_share.sql
-- =========================================================

create table if not exists public.report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  section text not null check (section in ('overall','top_creators','top_videos','gmv_max','product_highlights','insights')),
  author_type text not null check (author_type in ('client','bob','apc')),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists rc_report_idx on public.report_comments(report_id);
create index if not exists rc_section_idx on public.report_comments(report_id, section);

alter table public.report_comments enable row level security;

-- Bob: full access
drop policy if exists "rc bob all" on public.report_comments;
create policy "rc bob all" on public.report_comments
  for all using (public.is_bob()) with check (public.is_bob());

-- APC: can read/write comments on reports for their assigned brands
drop policy if exists "rc apc read" on public.report_comments;
create policy "rc apc read" on public.report_comments
  for select using (
    exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "rc apc insert" on public.report_comments;
create policy "rc apc insert" on public.report_comments
  for insert with check (
    exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "rc apc delete own" on public.report_comments;
create policy "rc apc delete own" on public.report_comments
  for delete using (
    author_type = 'apc' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    )
  );

-- Public clients insert via edge function (service role) — no public RLS policy needed
