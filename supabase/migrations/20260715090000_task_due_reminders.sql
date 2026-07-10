-- =========================================================
-- Afflix Core — Auto-remind on due date
--
-- When an open task's due_date is reached (today or past) it now automatically
-- gets a reminder — the same reminder the "Remind" button creates: a row in
-- task_reminders, which fires the assignee's notification + blocking acknowledge
-- alert, and is tracked in the ack UI. Fires ONCE per task (guarded by
-- tasks.due_reminded_at); moving the due date re-arms it.
--
-- Runs via public.fire_due_task_reminders() — SECURITY DEFINER, idempotent, safe
-- to call repeatedly. The front-end calls it on the Tasks page load; an optional
-- pg_cron schedule (below) fires it server-side even with no session open.
--
-- ADDITIVE. Reuses task_reminders + its fill/notify triggers (20260708).
-- =========================================================

alter table public.tasks add column if not exists due_reminded_at timestamptz;

-- Don't retro-fire for tasks that are already due/overdue at deploy time — only
-- tasks that reach their due date AFTER this migration should auto-remind.
update public.tasks set due_reminded_at = now()
  where due_date is not null and due_date <= current_date and due_reminded_at is null;

-- Re-arm the auto-reminder whenever the due date is changed (e.g. extended).
create or replace function public.tasks_rearm_due_reminder()
returns trigger language plpgsql as $$
begin
  if new.due_date is distinct from old.due_date then
    new.due_reminded_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_rearm_due on public.tasks;
create trigger tasks_rearm_due
  before update of due_date on public.tasks
  for each row execute function public.tasks_rearm_due_reminder();

-- Fire a reminder for every open task whose due date has arrived and that hasn't
-- been auto-reminded yet. created_by carries the task's assigner (so the ack goes
-- back to them); task_reminders_fill fills assignee_id from the task.
create or replace function public.fire_due_task_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare fired int;
begin
  with due as (
    select id, created_by from public.tasks
    where status <> 'done'
      and due_date is not null
      and due_date <= current_date
      and due_reminded_at is null
    for update skip locked
  ), ins as (
    insert into public.task_reminders (task_id, created_by)
    select id, created_by from due
    returning 1
  ), upd as (
    update public.tasks t set due_reminded_at = now()
      from due where t.id = due.id
    returning 1
  )
  select count(*) into fired from upd;
  return fired;
end $$;

grant execute on function public.fire_due_task_reminders() to authenticated;

-- =========================================================
-- OPTIONAL — fire server-side every hour (run once, after enabling pg_cron):
--
--   select cron.schedule('fire-due-task-reminders', '0 * * * *',
--     $cron$ select public.fire_due_task_reminders(); $cron$);
--
-- Until then the front-end calls fire_due_task_reminders() on the Tasks load.
-- =========================================================
