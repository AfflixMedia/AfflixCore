-- =========================================================
-- Afflix Core - Testing Notifications (Bob-only mirror log)
-- A separate table that captures every notification Bob receives,
-- so the "Testing Notification" page can show all of them.
-- Run AFTER schema_notifications.sql
-- =========================================================

create table if not exists public.testing_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid unique references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  payload jsonb,
  read_at timestamptz,
  source_created_at timestamptz,         -- original notification's created_at
  created_at timestamptz not null default now()
);

create index if not exists testing_notifications_user_idx
  on public.testing_notifications(user_id, source_created_at desc);

alter table public.testing_notifications enable row level security;

-- A Bob can read their own mirrored rows…
drop policy if exists "testing_notifications self read" on public.testing_notifications;
create policy "testing_notifications self read" on public.testing_notifications
  for select using (auth.uid() = user_id);

-- …and is_bob() can read all (admin overview parity with notifications table).
drop policy if exists "testing_notifications bob read" on public.testing_notifications;
create policy "testing_notifications bob read" on public.testing_notifications
  for select using (public.is_bob());

-- ---------------------------------------------------------
-- Backfill: copy every existing notification belonging to a
-- profile with role = 'bob' into the mirror table.
-- ---------------------------------------------------------
insert into public.testing_notifications
  (notification_id, user_id, type, title, body, link, payload, read_at, source_created_at)
select n.id, n.user_id, n.type, n.title, n.body, n.link, n.payload, n.read_at, n.created_at
from public.notifications n
join public.profiles p on p.id = n.user_id and p.role = 'bob'
on conflict (notification_id) do nothing;

-- ---------------------------------------------------------
-- Trigger: mirror new notifications for Bob into the table,
-- and keep read_at in sync when the original is marked read.
-- ---------------------------------------------------------
create or replace function public.mirror_bob_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles where id = new.user_id and role = 'bob') then
      insert into public.testing_notifications
        (notification_id, user_id, type, title, body, link, payload, read_at, source_created_at)
      values
        (new.id, new.user_id, new.type, new.title, new.body, new.link, new.payload, new.read_at, new.created_at)
      on conflict (notification_id) do nothing;
    end if;
  elsif tg_op = 'UPDATE' then
    update public.testing_notifications
      set read_at = new.read_at
    where notification_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists mirror_bob_notification_ins on public.notifications;
create trigger mirror_bob_notification_ins
  after insert on public.notifications
  for each row execute function public.mirror_bob_notification();

drop trigger if exists mirror_bob_notification_upd on public.notifications;
create trigger mirror_bob_notification_upd
  after update of read_at on public.notifications
  for each row execute function public.mirror_bob_notification();

-- Realtime: let the Testing Notification page subscribe to inserts.
do $$
begin
  alter publication supabase_realtime add table public.testing_notifications;
exception
  when duplicate_object then null;
end;
$$;
