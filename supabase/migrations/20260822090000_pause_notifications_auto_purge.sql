-- =========================================================
-- Afflix Core — PAUSE the notifications auto-purge (2026-07-21)
--
-- Base: 20260805090000_notifications_auto_purge.sql (+ hotfix 20260808090000)
-- installed a statement-level AFTER INSERT trigger on public.notifications that
-- deletes rows older than 14 days, throttled to once/hour.
--
-- User call: keep every notification for now — stop the automatic deletion.
-- The trigger + function are LEFT IN PLACE, just disabled, so nothing else
-- changes and re-enabling is a one-liner:
--
--   alter table public.notifications enable trigger notifications_auto_purge;
--
-- public.purge_old_notifications() stays callable for a manual sweep.
-- =========================================================

alter table public.notifications disable trigger notifications_auto_purge;
