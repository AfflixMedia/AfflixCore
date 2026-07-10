-- =========================================================
-- Afflix Core — Recurring tasks ("task alarms")
--
-- A recurrence is a template + schedule (daily / weekly on a weekday /
-- monthly on a day / every N days). A due recurrence auto-creates a real task
-- for each of its assignees (sharing a group_id when >1, exactly like a manual
-- multi-assign) and advances to its next slot. Generated tasks fire the normal
-- tasks_notify assignment notification.
--
-- Generation runs via public.generate_due_recurring_tasks() — SECURITY DEFINER,
-- idempotent (advances next_run), safe to call repeatedly. The front-end calls
-- it on the Tasks page load; an optional pg_cron schedule (below, commented)
-- makes it fire server-side even when no one is online — same pattern as
-- fire_due_note_reminders().
--
-- ADDITIVE. Reuses is_bob(), is_team_lead(), tasks.group_id (20260710).
-- =========================================================

-- Next scheduled date strictly AFTER from_date for a given frequency.
create or replace function public.task_next_run(from_date date, freq text, n int, wd int, dom int)
returns date language plpgsql immutable as $$
declare d date; lastday int; ahead int;
begin
  if freq = 'daily' then
    return from_date + 1;
  elsif freq = 'every_n_days' then
    return from_date + greatest(coalesce(n, 1), 1);
  elsif freq = 'weekly' then
    ahead := ((coalesce(wd, 0) - extract(dow from from_date)::int) + 7) % 7;
    if ahead = 0 then ahead := 7; end if;               -- today already fired → next week
    return from_date + ahead;
  elsif freq = 'monthly' then
    d := date_trunc('month', from_date)::date;          -- 1st of from_date's month
    lastday := extract(day from (d + interval '1 month - 1 day'))::int;
    d := d + (least(coalesce(dom, 1), lastday) - 1);    -- clamp to month length (e.g. 31 → 28/30)
    if d <= from_date then                              -- this month's slot passed → next month
      d := (date_trunc('month', from_date) + interval '1 month')::date;
      lastday := extract(day from (d + interval '1 month - 1 day'))::int;
      d := d + (least(coalesce(dom, 1), lastday) - 1);
    end if;
    return d;
  end if;
  return from_date + 1;
end $$;

-- ---------- Recurrence templates ----------
create table if not exists public.task_recurrences (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title           text not null,
  description     text,
  brand_id        uuid references public.brands(id) on delete set null,
  priority        text not null default 'mid' check (priority in ('low','mid','high')),
  folder_id       uuid references public.task_folders(id) on delete set null,
  label_ids       uuid[] not null default '{}',
  assignee_ids    uuid[] not null,                       -- fan out to each of these per occurrence
  frequency       text not null check (frequency in ('daily','weekly','monthly','every_n_days')),
  interval_days   int,                                   -- every_n_days
  weekday         int check (weekday between 0 and 6),   -- weekly (0=Sun … 6=Sat)
  day_of_month    int check (day_of_month between 1 and 31), -- monthly
  due_offset_days int,                                   -- occurrence due = run date + this (null = no due date)
  active          boolean not null default true,
  next_run        date not null default current_date,    -- next date to generate on
  last_run_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists task_recurrences_due_idx on public.task_recurrences(next_run) where active;
create index if not exists task_recurrences_owner_idx on public.task_recurrences(created_by);
alter table public.task_recurrences enable row level security;

-- Bob oversees all; a Team Lead manages their own schedules.
drop policy if exists "task_recurrences bob all" on public.task_recurrences;
create policy "task_recurrences bob all" on public.task_recurrences
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "task_recurrences owner all" on public.task_recurrences;
create policy "task_recurrences owner all" on public.task_recurrences
  for all using (created_by = auth.uid())
  with check (created_by = auth.uid() and (public.is_bob() or public.is_team_lead()));

-- ---------- Generation ----------
-- Materialize every due recurrence into real tasks and advance its next_run.
-- Missed slots are skipped (no backlog spam) — one occurrence per due row.
create or replace function public.generate_due_recurring_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r   record;
  gid uuid;
  a   uuid;
  due date;
  made int := 0;
begin
  for r in
    select * from public.task_recurrences
    where active and next_run <= current_date
    for update skip locked
  loop
    if coalesce(array_length(r.assignee_ids, 1), 0) = 0 then
      -- nothing to assign — just advance so it doesn't spin
      update public.task_recurrences
         set next_run = public.task_next_run(current_date, r.frequency, r.interval_days, r.weekday, r.day_of_month),
             last_run_at = now()
       where id = r.id;
      continue;
    end if;

    gid := case when array_length(r.assignee_ids, 1) > 1 then gen_random_uuid() else null end;
    due := case when r.due_offset_days is not null then current_date + r.due_offset_days else null end;

    foreach a in array r.assignee_ids loop
      insert into public.tasks
        (created_by, assignee_id, brand_id, title, description, priority, folder_id, label_ids, due_date, group_id)
      values
        (r.created_by, a, r.brand_id, r.title, r.description, r.priority, r.folder_id, r.label_ids, due, gid);
      made := made + 1;
    end loop;

    update public.task_recurrences
       set next_run = public.task_next_run(current_date, r.frequency, r.interval_days, r.weekday, r.day_of_month),
           last_run_at = now()
     where id = r.id;
  end loop;

  return made;
end $$;

grant execute on function public.generate_due_recurring_tasks() to authenticated;

-- Realtime so the schedule manager updates live.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_recurrences') then
    alter publication supabase_realtime add table public.task_recurrences;
  end if;
end $$;

-- =========================================================
-- OPTIONAL — fire server-side every hour even with no session open
-- (run once in the SQL editor after enabling pg_cron):
--
--   select cron.schedule('generate-recurring-tasks', '0 * * * *',
--     $cron$ select public.generate_due_recurring_tasks(); $cron$);
--
-- Until then the front-end calls generate_due_recurring_tasks() on the
-- Tasks page load, which materializes any due recurrences.
-- =========================================================
