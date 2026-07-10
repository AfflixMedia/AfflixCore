-- =========================================================
-- Afflix Core — Auto-purge notifications older than two weeks
--
-- Notifications are transient (chat pings, task updates, reminders); rows
-- older than 14 days are dead weight for the bell dropdown + unread counts.
-- public.purge_old_notifications() deletes everything past the cutoff.
--
-- AUTO-TRIGGERED without pg_cron: a statement-level AFTER INSERT trigger on
-- notifications runs the purge whenever a new notification lands, throttled
-- to at most once per hour via a single-row state table (so busy fan-outs —
-- chat messages notify every member in one statement — pay nothing extra).
-- Notifications are inserted constantly (chat/tasks/reports), so the sweep
-- effectively runs hourly with zero front-end or cron wiring.
--
-- ADDITIVE — no existing tables/policies changed.
-- =========================================================

-- Deletes scan by created_at; the existing index leads with user_id.
create index if not exists notifications_created_idx
  on public.notifications(created_at);

-- Single-row bookkeeping so the trigger can throttle cheaply.
create table if not exists public.notifications_purge_state (
  id boolean primary key default true check (id),  -- at most one row
  last_purged_at timestamptz not null default '-infinity'
);
insert into public.notifications_purge_state (id) values (true)
  on conflict (id) do nothing;

-- Internal only: RLS on with no policies — clients can't read or touch it;
-- the SECURITY DEFINER function below bypasses RLS.
alter table public.notifications_purge_state enable row level security;

-- Delete every notification older than two weeks. Idempotent, safe to call
-- repeatedly; returns how many rows were removed.
create or replace function public.purge_old_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare purged int;
begin
  delete from public.notifications
    where created_at < now() - interval '14 days';
  get diagnostics purged = row_count;
  update public.notifications_purge_state set last_purged_at = now();
  return purged;
end $$;

grant execute on function public.purge_old_notifications() to authenticated;

-- Trigger body: skip unless the last sweep is over an hour old. skip locked
-- makes concurrent inserters fall through instead of queuing on the row.
create or replace function public.notifications_purge_tick()
returns trigger language plpgsql security definer set search_path = public as $$
declare due boolean;
begin
  select last_purged_at < now() - interval '1 hour' into due
    from public.notifications_purge_state
    where id for update skip locked;
  if due then
    perform public.purge_old_notifications();
  end if;
  return null;
end $$;

drop trigger if exists notifications_auto_purge on public.notifications;
create trigger notifications_auto_purge
  after insert on public.notifications
  for each statement execute function public.notifications_purge_tick();

-- Sweep the existing backlog once at deploy time.
select public.purge_old_notifications();

-- =========================================================
-- OPTIONAL — also fire server-side daily (run once, after enabling pg_cron),
-- covers the edge case of zero new notifications arriving for days:
--
--   select cron.schedule('purge-old-notifications', '0 4 * * *',
--     $cron$ select public.purge_old_notifications(); $cron$);
-- =========================================================
