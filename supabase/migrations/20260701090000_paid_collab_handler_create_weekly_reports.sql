-- =========================================================
-- Afflix Core — Let paid-collab handlers CREATE a brand's weekly reports.
--
-- From the paid-collab workspace a handler can add the next weekly report for an
-- assigned brand (the next week auto-fills from the brand's existing reports), and
-- on the very first report set the brand's weekly anchor (week-1 start date). This
-- mirrors the APC/Bob "create weekly report" flow and keeps everyone on the same
-- weekly cycle (weekly reports + brand_report_settings are the shared source).
--
-- Additive RLS only, scoped strictly to brands assigned to the handler
-- (paid_collab_handler_brands). Existing bob/apc/team_lead policies are untouched.
-- The handler still CANNOT update or delete weekly reports.
-- =========================================================

-- weekly_reports: handler may INSERT a (draft) report for an assigned brand.
drop policy if exists "wr insert paid collab handler" on public.weekly_reports;
create policy "wr insert paid collab handler" on public.weekly_reports
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.paid_collab_handler_brands h
      where h.brand_id = weekly_reports.brand_id and h.handler_id = auth.uid()
    )
  );

-- brand_report_settings: handler may READ + SET the weekly anchor for an assigned brand.
drop policy if exists "brs read paid collab handler" on public.brand_report_settings;
create policy "brs read paid collab handler" on public.brand_report_settings
  for select to authenticated
  using (
    exists (
      select 1 from public.paid_collab_handler_brands h
      where h.brand_id = brand_report_settings.brand_id and h.handler_id = auth.uid()
    )
  );

drop policy if exists "brs write paid collab handler" on public.brand_report_settings;
create policy "brs write paid collab handler" on public.brand_report_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.paid_collab_handler_brands h
      where h.brand_id = brand_report_settings.brand_id and h.handler_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.paid_collab_handler_brands h
      where h.brand_id = brand_report_settings.brand_id and h.handler_id = auth.uid()
    )
  );
