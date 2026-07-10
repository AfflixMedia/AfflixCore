-- =========================================================
-- Afflix Core — Task status: add "in_progress"
--
-- Tasks had two states: 'open' (not started) and 'done' (completed). This adds
-- a middle 'in_progress' state. Mapping in the UI:
--   open        → "Not started" (default)
--   in_progress → "In progress"
--   done        → "Completed"
--
-- Anyone who can already update the task (assignee, creator, Bob — via the
-- existing RLS policies) can move it between the three states. completed_at is
-- only set when status = 'done'; tasks_notify still fires only on the → done
-- transition, so 'in_progress' does not spam notifications.
--
-- ADDITIVE: just widens the CHECK constraint. Existing rows keep open/done.
-- =========================================================
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check check (status in ('open', 'in_progress', 'done'));
