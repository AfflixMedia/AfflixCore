-- =========================================================
-- Afflix Core - Roll back Testing Notifications
-- Reverses 20260606090000_testing_notifications.sql:
-- drops the mirror triggers, function, and table.
-- =========================================================

drop trigger if exists mirror_bob_notification_ins on public.notifications;
drop trigger if exists mirror_bob_notification_upd on public.notifications;

drop function if exists public.mirror_bob_notification();

-- Dropping the table also removes its policies, index, FK,
-- and its membership in the supabase_realtime publication.
drop table if exists public.testing_notifications;
