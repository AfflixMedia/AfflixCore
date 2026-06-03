-- =========================================================
-- Afflix Core - Make report_comments / report_approval_decisions
-- truly polymorphic across weekly_reports + monthly_reports.
--
-- The original FK on report_id pointed to weekly_reports only, which
-- caused inserts to fail (with a non-2xx edge-function response) when
-- the report_type was 'monthly' because the monthly UUID isn't in
-- weekly_reports. Drop the FK, replace cascade-delete with triggers,
-- and update APC RLS policies to honour report_type.
-- =========================================================

-- 1. Drop the weekly-only FKs
alter table public.report_comments
  drop constraint if exists report_comments_report_id_fkey;
alter table public.report_approval_decisions
  drop constraint if exists report_approval_decisions_report_id_fkey;

-- 2. Replace cascade-delete with triggers on each report table

create or replace function public.cleanup_weekly_report_refs()
returns trigger
language plpgsql
security definer
as $$
begin
  delete from public.report_comments
   where report_type = 'weekly' and report_id = old.id;
  delete from public.report_approval_decisions
   where report_type = 'weekly' and report_id = old.id;
  return old;
end;
$$;

drop trigger if exists weekly_reports_cleanup on public.weekly_reports;
create trigger weekly_reports_cleanup
  before delete on public.weekly_reports
  for each row execute function public.cleanup_weekly_report_refs();

create or replace function public.cleanup_monthly_report_refs()
returns trigger
language plpgsql
security definer
as $$
begin
  delete from public.report_comments
   where report_type = 'monthly' and report_id = old.id;
  delete from public.report_approval_decisions
   where report_type = 'monthly' and report_id = old.id;
  return old;
end;
$$;

drop trigger if exists monthly_reports_cleanup on public.monthly_reports;
create trigger monthly_reports_cleanup
  before delete on public.monthly_reports
  for each row execute function public.cleanup_monthly_report_refs();

-- 3. Re-issue APC RLS policies on report_comments to consult both
--    weekly_reports and monthly_reports based on report_type.

drop policy if exists "rc apc read" on public.report_comments;
create policy "rc apc read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      join public.apc_brands ab on ab.brand_id = mr.brand_id
      where mr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
  );

drop policy if exists "rc apc insert" on public.report_comments;
create policy "rc apc insert" on public.report_comments
  for insert with check (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      join public.apc_brands ab on ab.brand_id = mr.brand_id
      where mr.id = report_comments.report_id and ab.apc_id = auth.uid()
    ))
  );

drop policy if exists "rc apc delete own" on public.report_comments;
create policy "rc apc delete own" on public.report_comments
  for delete using (
    author_type = 'apc' and (
      (report_type = 'weekly' and exists (
        select 1 from public.weekly_reports wr
        join public.apc_brands ab on ab.brand_id = wr.brand_id
        where wr.id = report_comments.report_id and ab.apc_id = auth.uid()
      ))
      or (report_type = 'monthly' and exists (
        select 1 from public.monthly_reports mr
        join public.apc_brands ab on ab.brand_id = mr.brand_id
        where mr.id = report_comments.report_id and ab.apc_id = auth.uid()
      ))
    )
  );

-- 4. Same for report_approval_decisions APC read

drop policy if exists "rad apc read" on public.report_approval_decisions;
create policy "rad apc read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      join public.apc_brands ab on ab.brand_id = wr.brand_id
      where wr.id = report_approval_decisions.report_id and ab.apc_id = auth.uid()
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      join public.apc_brands ab on ab.brand_id = mr.brand_id
      where mr.id = report_approval_decisions.report_id and ab.apc_id = auth.uid()
    ))
  );
