-- =========================================================
-- Backfill: any report that asks the client for approval must be
-- visible via the share link. Flip is_shared on for reports where the
-- approval section is enabled but sharing was off. Going forward,
-- WeeklyReportEdit's submit handler enforces this on save.
-- =========================================================

update public.weekly_reports
set is_shared = true
where coalesce((content->'approval'->>'enabled')::boolean, false) = true
  and is_shared = false;
