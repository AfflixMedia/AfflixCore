-- =========================================================
-- Afflix Core — fix: notifications purge broke task assignment.
--
-- purge_old_notifications() (20260805) stamped its single-row throttle table
-- with `update ... set last_purged_at = now()` and NO WHERE clause. API
-- connections run with the safeupdate guard, which rejects that with
-- "UPDATE requires a WHERE clause" — and because the purge fires from an
-- AFTER INSERT trigger on notifications, the error aborted the notification
-- INSERT *and its caller*: once an hour, the next task assignment (or any
-- other notification-producing action) failed. The deploy-time run worked
-- because `db push` connects as postgres, where safeupdate isn't loaded.
--
-- Fix: same function with `where id` (the table holds at most one row,
-- id boolean primary key). Behaviour otherwise identical.
--
-- Gotcha for future functions: every UPDATE/DELETE must carry a WHERE
-- clause, even on intentionally-single-row tables — SECURITY DEFINER
-- functions still run under safeupdate when called from API connections.
-- =========================================================

create or replace function public.purge_old_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare purged int;
begin
  delete from public.notifications
    where created_at < now() - interval '14 days';
  get diagnostics purged = row_count;
  update public.notifications_purge_state set last_purged_at = now() where id;
  return purged;
end $$;
