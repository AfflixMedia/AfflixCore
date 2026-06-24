-- =========================================================
-- Afflix Core — Let paid-collab handlers READ a brand's weekly reports.
--
-- The paid-collab handler workspace Performance tab can track GMV / Ad per WEEK.
-- Those weekly columns are aligned to the brand's existing weekly-report dates
-- (week_start), so the handler needs read-only access to weekly_reports for the
-- brands assigned to them. If a brand has no weekly reports yet, the workspace
-- falls back to the creators' onboarding date — no DB access needed for that.
--
-- The handler does NOT set anchors or write anything here; this is read-only and
-- scoped strictly to brands the handler is assigned (paid_collab_handler_brands).
-- Existing bob / apc / team_lead policies on weekly_reports are left untouched.
-- =========================================================

drop policy if exists "wr read paid collab handler" on public.weekly_reports;
create policy "wr read paid collab handler" on public.weekly_reports
  for select to authenticated
  using (
    exists (
      select 1 from public.paid_collab_handler_brands h
      where h.brand_id = weekly_reports.brand_id
        and h.handler_id = auth.uid()
    )
  );
