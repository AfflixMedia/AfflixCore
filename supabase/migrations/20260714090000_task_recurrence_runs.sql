-- =========================================================
-- Afflix Core — Recurring-task run history + task linkage
--
-- Keeps a record of every time a recurrence fires:
--   * tasks.recurrence_id     — each generated task points back to its schedule
--   * task_recurrence_runs     — one row per firing (date, group, how many made)
--
-- generate_due_recurring_tasks() is updated to stamp recurrence_id on the tasks
-- it creates and to log a run row. Generated tasks still default to status
-- 'open' and still fire tasks_notify (assignee notification) on insert.
--
-- ADDITIVE. Builds on 20260711 (recurrences) + 20260710 (group_id).
-- =========================================================

-- Link generated tasks back to their schedule.
alter table public.tasks
  add column if not exists recurrence_id uuid references public.task_recurrences(id) on delete set null;
create index if not exists tasks_recurrence_idx on public.tasks(recurrence_id);

-- One row per firing of a recurrence.
create table if not exists public.task_recurrence_runs (
  id            uuid primary key default gen_random_uuid(),
  recurrence_id uuid not null references public.task_recurrences(id) on delete cascade,
  run_on        date not null default current_date,
  group_id      uuid,               -- the group the occurrence's tasks share (null if single assignee)
  task_count    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists task_recurrence_runs_idx on public.task_recurrence_runs(recurrence_id, run_on desc);
alter table public.task_recurrence_runs enable row level security;

-- Read: Bob, or the owner of the parent schedule. (Inserts happen only inside the
-- SECURITY DEFINER generator, which bypasses RLS — no client insert policy needed.)
drop policy if exists "task_recurrence_runs read" on public.task_recurrence_runs;
create policy "task_recurrence_runs read" on public.task_recurrence_runs
  for select using (
    public.is_bob()
    or exists (select 1 from public.task_recurrences r where r.id = recurrence_id and r.created_by = auth.uid())
  );

-- Regenerate the generator: now stamps recurrence_id + logs a run row.
create or replace function public.generate_due_recurring_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r   record;
  gid uuid;
  a   uuid;
  due date;
  made int := 0;
  cnt int;
begin
  for r in
    select * from public.task_recurrences
    where active and next_run <= current_date
    for update skip locked
  loop
    if coalesce(array_length(r.assignee_ids, 1), 0) = 0 then
      update public.task_recurrences
         set next_run = public.task_next_run(current_date, r.frequency, r.interval_days, r.weekday, r.day_of_month),
             last_run_at = now()
       where id = r.id;
      continue;
    end if;

    gid := case when array_length(r.assignee_ids, 1) > 1 then gen_random_uuid() else null end;
    due := case when r.due_offset_days is not null then current_date + r.due_offset_days else null end;
    cnt := 0;

    foreach a in array r.assignee_ids loop
      insert into public.tasks
        (created_by, assignee_id, brand_id, title, description, priority, folder_id, label_ids, due_date, group_id, recurrence_id)
      values
        (r.created_by, a, r.brand_id, r.title, r.description, r.priority, r.folder_id, r.label_ids, due, gid, r.id);
      made := made + 1;
      cnt := cnt + 1;
    end loop;

    insert into public.task_recurrence_runs (recurrence_id, run_on, group_id, task_count)
    values (r.id, current_date, gid, cnt);

    update public.task_recurrences
       set next_run = public.task_next_run(current_date, r.frequency, r.interval_days, r.weekday, r.day_of_month),
           last_run_at = now()
     where id = r.id;
  end loop;

  return made;
end $$;

grant execute on function public.generate_due_recurring_tasks() to authenticated;

-- Realtime for the run log (manager updates live).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_recurrence_runs') then
    alter publication supabase_realtime add table public.task_recurrence_runs;
  end if;
end $$;
