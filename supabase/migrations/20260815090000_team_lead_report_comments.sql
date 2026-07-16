-- =========================================================
-- Afflix Core - Report client feedback: Team Leads can READ,
-- replying becomes Bob-only.
--
-- Team Leads have APC-level access to their assigned brands' reports
-- (routes + weekly/monthly_reports read since 20260616), but the client
-- feedback layer was never opened to them:
--   * report_comments had no team_lead policies, so the comments panel
--     loaded empty on their report views;
--   * report_approval_decisions had no team_lead read, so client
--     approve/reject decisions were hidden too.
-- New rule (user call, 2026-07-14): APCs and Team Leads only READ the
-- client feedback thread — replying is Bob-only. So this migration adds
-- read-only team_lead policies (mirroring the polymorphic APC pattern
-- from 20260509 via team_lead_has_brand) and DROPS the old APC /
-- ads_manager insert policies. Staff replies go through the
-- post-staff-comment edge function (service role, now rejects non-Bob
-- callers); the FE hides the Reply button for non-Bob staff.
-- "rc apc delete own" is left in place (deletion is disabled in the UI
-- anyway; historical APC-authored comments keep their policy).
-- =========================================================

-- 1. report_comments: read-only for the brand's Team Lead

drop policy if exists "rc team_lead read" on public.report_comments;
create policy "rc team_lead read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id
        and public.team_lead_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_comments.report_id
        and public.team_lead_has_brand(mr.brand_id)
    ))
  );

-- 2. Replying is Bob-only now: drop the non-Bob staff insert policies
--    ("rc bob all" remains; clients post via the public edge function,
--    which uses the service role and is unaffected by RLS).

drop policy if exists "rc apc insert" on public.report_comments;
drop policy if exists "rc ads_manager insert" on public.report_comments;

-- 3. report_approval_decisions: read-only for the brand's Team Lead
--    (decisions are written by the public share-link edge function;
--    staff only view them)

drop policy if exists "rad team_lead read" on public.report_approval_decisions;
create policy "rad team_lead read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_approval_decisions.report_id
        and public.team_lead_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_approval_decisions.report_id
        and public.team_lead_has_brand(mr.brand_id)
    ))
  );
