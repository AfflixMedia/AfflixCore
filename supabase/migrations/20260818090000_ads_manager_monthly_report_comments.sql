-- =========================================================
-- Afflix Core - Ads Manager: read MONTHLY report comments too.
--
-- "rc ads_manager read" (20260725) only joined weekly_reports, so an
-- Ads Manager could read a weekly report's client-feedback thread but
-- not a monthly report's — the monthly "Conversation" panel loaded empty
-- and the card's comment count stayed 0. Team Lead / APC read policies
-- are polymorphic (weekly OR monthly); this brings Ads Managers in line.
--
-- Read-only + brand-scoped (ads_manager_has_brand). Replying stays
-- Bob-only ("rc ads_manager insert" was dropped in 20260815).
-- =========================================================

drop policy if exists "rc ads_manager read" on public.report_comments;
create policy "rc ads_manager read" on public.report_comments
  for select using (
    (report_type = 'weekly' and exists (
      select 1 from public.weekly_reports wr
      where wr.id = report_comments.report_id
        and public.ads_manager_has_brand(wr.brand_id)
    ))
    or (report_type = 'monthly' and exists (
      select 1 from public.monthly_reports mr
      where mr.id = report_comments.report_id
        and public.ads_manager_has_brand(mr.brand_id)
    ))
  );
