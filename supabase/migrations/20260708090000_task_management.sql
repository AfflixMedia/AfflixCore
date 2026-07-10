-- =========================================================
-- Afflix Core — Task management upgrade
--
-- Adds to the task system (20260621090000_tasks.sql):
--   * priority (low|mid|high) — drives card colour in the UI
--   * folders / workspaces + labels (Bob + Team Leads organise tasks)
--   * task_reminders — a blocking full-screen alert the assigner pushes to the
--     task's APC; the APC must acknowledge with one of three responses
--     (seen | on_it | done). The chosen response is recorded + notified back.
--
-- ADDITIVE: new columns + tables + helpers + policies + notify triggers.
-- Reuses public.is_bob(), public.is_internal_staff(), public.manages_apc().
-- (Filed 20260708 to sit after the already-applied June/July migrations.)
-- =========================================================

-- ---------- Folders / workspaces ----------
create table if not exists public.task_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists task_folders_owner_idx on public.task_folders(owner_id);
alter table public.task_folders enable row level security;

-- Names aren't sensitive — any internal staff (bob/team_lead/apc) may read all,
-- so an APC can see the folder name/colour on their own tasks.
drop policy if exists "task_folders read staff" on public.task_folders;
create policy "task_folders read staff" on public.task_folders
  for select using (public.is_internal_staff());
-- Bob manages all; a Team Lead manages only the folders they own.
drop policy if exists "task_folders write owner" on public.task_folders;
create policy "task_folders write owner" on public.task_folders
  for all using (public.is_bob() or owner_id = auth.uid())
  with check (public.is_bob() or owner_id = auth.uid());

-- ---------- Labels ----------
create table if not exists public.task_labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists task_labels_owner_idx on public.task_labels(owner_id);
alter table public.task_labels enable row level security;

drop policy if exists "task_labels read staff" on public.task_labels;
create policy "task_labels read staff" on public.task_labels
  for select using (public.is_internal_staff());
drop policy if exists "task_labels write owner" on public.task_labels;
create policy "task_labels write owner" on public.task_labels
  for all using (public.is_bob() or owner_id = auth.uid())
  with check (public.is_bob() or owner_id = auth.uid());

-- ---------- Extend tasks ----------
alter table public.tasks
  add column if not exists priority  text not null default 'mid' check (priority in ('low','mid','high')),
  add column if not exists folder_id uuid references public.task_folders(id) on delete set null,
  add column if not exists label_ids uuid[] not null default '{}';
create index if not exists tasks_folder_idx on public.tasks(folder_id);

-- ---------- Reminders (blocking acknowledge alert) ----------
create table if not exists public.task_reminders (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,
  assignee_id     uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  acknowledged_at timestamptz,
  ack_response    text check (ack_response in ('seen','on_it','done'))
);
create index if not exists task_reminders_assignee_idx
  on public.task_reminders(assignee_id, acknowledged_at);
create index if not exists task_reminders_task_idx on public.task_reminders(task_id);
alter table public.task_reminders enable row level security;

-- Always target the task's real APC — the client never sets assignee_id.
create or replace function public.task_reminders_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select assignee_id into new.assignee_id from public.tasks where id = new.task_id;
  if new.assignee_id is null then
    raise exception 'task not found for reminder';
  end if;
  return new;
end;
$$;
drop trigger if exists task_reminders_before_insert on public.task_reminders;
create trigger task_reminders_before_insert
  before insert on public.task_reminders
  for each row execute function public.task_reminders_fill();

-- Bob: full oversight.
drop policy if exists "task_reminders bob all" on public.task_reminders;
create policy "task_reminders bob all" on public.task_reminders
  for all using (public.is_bob()) with check (public.is_bob());

-- Assigner can create a reminder for a task they own / manage.
drop policy if exists "task_reminders insert" on public.task_reminders;
create policy "task_reminders insert" on public.task_reminders
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (public.is_bob() or t.created_by = auth.uid() or public.manages_apc(t.assignee_id))
    )
  );

-- Assignee (APC): read their reminders + update them to acknowledge.
drop policy if exists "task_reminders assignee read" on public.task_reminders;
create policy "task_reminders assignee read" on public.task_reminders
  for select using (assignee_id = auth.uid());
drop policy if exists "task_reminders assignee ack" on public.task_reminders;
create policy "task_reminders assignee ack" on public.task_reminders
  for update using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

-- Assigner / managing Team Lead: read reminders they sent or oversee.
drop policy if exists "task_reminders sender read" on public.task_reminders;
create policy "task_reminders sender read" on public.task_reminders
  for select using (created_by = auth.uid() or public.manages_apc(assignee_id));

-- ---------- Reminder notifications ----------
create or replace function public.task_reminders_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_from text; v_to text; v_title text; v_resp text;
begin
  if TG_OP = 'INSERT' then
    select coalesce(nullif(full_name,''), email) into v_from from public.profiles where id = new.created_by;
    select title into v_title from public.tasks where id = new.task_id;
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (new.assignee_id, 'task_reminder',
            coalesce(v_from,'Someone') || ' is reminding you',
            coalesce(v_title,'A task') || ' — please acknowledge',
            '/tasks',
            jsonb_build_object('reminder_id', new.id, 'task_id', new.task_id));
    return new;
  elsif TG_OP = 'UPDATE' then
    if new.acknowledged_at is not null and old.acknowledged_at is null
       and new.created_by is not null then
      select coalesce(nullif(full_name,''), email) into v_to from public.profiles where id = new.assignee_id;
      select title into v_title from public.tasks where id = new.task_id;
      v_resp := case new.ack_response
                  when 'seen' then 'saw it 👁'
                  when 'on_it' then 'is on it 👍'
                  when 'done' then 'marked it done ✅'
                  else 'acknowledged' end;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.created_by, 'task_reminder_ack',
              coalesce(v_to,'An APC') || ' ' || v_resp,
              coalesce(v_title,'A task'),
              '/tasks',
              jsonb_build_object('reminder_id', new.id, 'task_id', new.task_id, 'ack_response', new.ack_response));
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists task_reminders_after_insert on public.task_reminders;
create trigger task_reminders_after_insert after insert on public.task_reminders
  for each row execute function public.task_reminders_notify();

drop trigger if exists task_reminders_after_ack on public.task_reminders;
create trigger task_reminders_after_ack after update of acknowledged_at on public.task_reminders
  for each row execute function public.task_reminders_notify();

-- ---------- Realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_reminders') then
    alter publication supabase_realtime add table public.task_reminders;
  end if;
end $$;
