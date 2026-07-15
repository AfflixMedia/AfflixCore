-- =========================================================
-- Afflix Core - Ads Manager: read client approval decisions.
--
-- Ads Managers already read a report's client-feedback thread
-- ("rc ads_manager read" on report_comments, 20260725) but never had a
-- read policy on report_approval_decisions. That left the new weekly/
-- monthly "Approved" tab empty for them: the tab keys off approved
-- decisions, and RLS was silently filtering every decision row out.
--
-- This adds a read-only policy mirroring the Team Lead one (20260815),
-- scoped to the Ads Manager's brands via ads_manager_has_brand().
-- Replying stays Bob-only (unchanged) — decisions are written by the
-- public share-link edge function anyway; staff only view them.
-- =========================================================

drop policy if exists "rad ads_manager read" on public.report_approval_decisions;
create policy "rad ads_manager read" on public.report_approval_decisions
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_approval_decisions.report_id
        and public.ads_manager_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_approval_decisions.report_id
        and public.ads_manager_has_brand(mr.brand_id)
    ))
  );
