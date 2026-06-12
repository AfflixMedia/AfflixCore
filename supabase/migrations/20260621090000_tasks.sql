-- =========================================================
-- Afflix Core — Task assignment (Phase 3)
--
-- A Team Lead assigns tasks to their APCs; the APC is notified and marks them
-- done (which notifies the Team Lead back). Bob has oversight of all tasks.
--
-- ADDITIVE: new table + helper + policies + notify triggers.
-- =========================================================

-- Helper so an APC can read their own Team Lead's profile row (e.g. to show who
-- assigned a task). SECURITY DEFINER avoids RLS recursion on profiles.
create or replace function public.my_team_lead()
returns uuid language sql stable security definer set search_path = public as $$
  select team_lead_id from public.profiles where id = auth.uid();
$$;
grant execute on function public.my_team_lead() to authenticated;

drop policy if exists "profiles apc read own lead" on public.profiles;
create policy "profiles apc read own lead" on public.profiles
  for select using (id = public.my_team_lead());

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid references public.profiles(id) on delete set null,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  brand_id    uuid references public.brands(id) on delete set null,
  title       text not null,
  description text,
  status      text not null default 'open' check (status in ('open','done')),
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_assignee_idx on public.tasks(assignee_id, status);
create index if not exists tasks_creator_idx  on public.tasks(created_by);
create index if not exists tasks_brand_idx    on public.tasks(brand_id);

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.tasks enable row level security;

-- Bob: full oversight.
drop policy if exists "tasks bob all" on public.tasks;
create policy "tasks bob all" on public.tasks
  for all using (public.is_bob()) with check (public.is_bob());

-- Team Lead: manage tasks they created / for APCs they own.
drop policy if exists "tasks lead read" on public.tasks;
create policy "tasks lead read" on public.tasks
  for select using (created_by = auth.uid() or public.manages_apc(assignee_id));
drop policy if exists "tasks lead insert" on public.tasks;
create policy "tasks lead insert" on public.tasks
  for insert with check (created_by = auth.uid() and public.manages_apc(assignee_id));
drop policy if exists "tasks lead update" on public.tasks;
create policy "tasks lead update" on public.tasks
  for update using (created_by = auth.uid() or public.manages_apc(assignee_id))
  with check (created_by = auth.uid() or public.manages_apc(assignee_id));
drop policy if exists "tasks lead delete" on public.tasks;
create policy "tasks lead delete" on public.tasks
  for delete using (created_by = auth.uid() or public.manages_apc(assignee_id));

-- Assignee (APC): read their tasks + update them (mark done).
drop policy if exists "tasks assignee read" on public.tasks;
create policy "tasks assignee read" on public.tasks
  for select using (assignee_id = auth.uid());
drop policy if exists "tasks assignee update" on public.tasks;
create policy "tasks assignee update" on public.tasks
  for update using (assignee_id = auth.uid()) with check (assignee_id = auth.uid());

-- ---------- Notifications ----------
create or replace function public.tasks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_brand text;
begin
  if TG_OP = 'INSERT' then
    select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.created_by;
    select name into v_brand from public.brands where id = new.brand_id;
    if new.assignee_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000') then
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.assignee_id, 'task',
              coalesce(v_name,'Your Team Lead') || ' assigned you a task',
              new.title
                || case when v_brand is not null then ' · ' || v_brand else '' end
                || case when new.due_date is not null then ' (due ' || to_char(new.due_date,'Mon DD') || ')' else '' end,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'brand_id', new.brand_id, 'kind', 'assigned'));
    end if;
    return new;
  elsif TG_OP = 'UPDATE' then
    if new.status = 'done' and old.status is distinct from 'done'
       and new.created_by is not null and new.created_by <> new.assignee_id then
      select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.assignee_id;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.created_by, 'task',
              coalesce(v_name,'An APC') || ' completed a task',
              new.title,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'kind', 'completed'));
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_after_insert on public.tasks;
create trigger tasks_after_insert after insert on public.tasks
  for each row execute function public.tasks_notify();

drop trigger if exists tasks_after_status on public.tasks;
create trigger tasks_after_status after update of status on public.tasks
  for each row execute function public.tasks_notify();

-- Realtime so task lists / badges update live.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;
