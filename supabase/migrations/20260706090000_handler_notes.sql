-- =========================================================
-- Afflix Core — Paid Collab handler "Keep-style" notes board
-- Global notes for the handler workspace: many colored note
-- cards, free-form labels, optional brand/program (month) link,
-- and reminders that fire in-app notifications (+ web push via
-- the send-push edge function, scheduled with pg_cron).
--
-- Applied manually via Supabase SQL editor / `supabase db push`.
-- =========================================================

create table if not exists public.handler_notes (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brand_id         uuid references public.brands(id) on delete set null,  -- optional "brand-wise" link
  month            text,                                                  -- optional "program-wise" link, 'YYYY-MM'
  title            text not null default '',
  body             text not null default '',
  color            text not null default 'default',                       -- Keep-style card color key
  labels           text[] not null default '{}',                         -- free-form tags
  pinned           boolean not null default false,
  archived         boolean not null default false,
  reminder_at      timestamptz,                                          -- when to remind (null = none)
  reminder_done    boolean not null default false,                       -- user dismissed/completed the reminder
  reminder_sent_at timestamptz,                                          -- notification already fired (dedupe)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists handler_notes_owner_idx
  on public.handler_notes(owner_id, archived, pinned, updated_at desc);
create index if not exists handler_notes_reminder_idx
  on public.handler_notes(reminder_at)
  where reminder_at is not null and reminder_sent_at is null and not archived and not reminder_done;

-- keep updated_at fresh
create or replace function public.handler_notes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- re-arm the reminder if its time was changed/cleared
  if (new.reminder_at is distinct from old.reminder_at) then
    new.reminder_sent_at := null;
    new.reminder_done := false;
  end if;
  return new;
end $$;

drop trigger if exists handler_notes_touch on public.handler_notes;
create trigger handler_notes_touch
  before update on public.handler_notes
  for each row execute function public.handler_notes_touch();

-- ── RLS: owner-only CRUD; Bob can read everything ──
alter table public.handler_notes enable row level security;

drop policy if exists "handler_notes owner all" on public.handler_notes;
create policy "handler_notes owner all" on public.handler_notes
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "handler_notes bob read" on public.handler_notes;
create policy "handler_notes bob read" on public.handler_notes
  for select using (public.is_bob());

-- Realtime so the board updates live across the handler's tabs/devices
do $$ begin
  alter publication supabase_realtime add table public.handler_notes;
exception when duplicate_object then null;
end $$;

-- ── Reminder fan-out ──
-- Materializes due reminders into in-app notifications and marks them sent.
-- Safe to call repeatedly (idempotent via reminder_sent_at). Returns count fired.
create or replace function public.fire_due_note_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  fired integer;
begin
  with due as (
    select id, owner_id, title, body, brand_id, month
    from public.handler_notes
    where reminder_at is not null
      and reminder_at <= now()
      and reminder_sent_at is null
      and not archived
      and not reminder_done
    for update skip locked
  ), ins as (
    insert into public.notifications (user_id, type, title, body, link, payload)
    select owner_id,
           'note_reminder',
           'Reminder: ' || coalesce(nullif(btrim(title), ''), 'Note'),
           left(nullif(btrim(body), ''), 160),
           '/paid-collab',
           jsonb_build_object('note_id', id, 'brand_id', brand_id, 'month', month)
    from due
    returning 1
  ), upd as (
    update public.handler_notes hn
       set reminder_sent_at = now()
      from due
     where hn.id = due.id
    returning 1
  )
  select count(*) into fired from upd;
  return fired;
end $$;

-- =========================================================
-- OPTIONAL — schedule reminders + web push (run once, in the
-- Supabase SQL editor, after enabling the pg_cron + pg_net
-- extensions and storing the service-role key in Vault).
--
-- 1) Database → Extensions: enable `pg_cron` and `pg_net`.
-- 2) Store secrets in Vault (Database → Vault):
--      project_url        = https://<ref>.supabase.co
--      service_role_key   = <service role key>
-- 3) Run:
--
--   select cron.schedule(
--     'fire-note-reminders', '* * * * *',
--     $cron$
--       with fired as (
--         -- snapshot owners about to be notified (for push)
--         select owner_id from public.handler_notes
--         where reminder_at is not null and reminder_at <= now()
--           and reminder_sent_at is null and not archived and not reminder_done
--       ), n as ( select public.fire_due_note_reminders() )
--       select net.http_post(
--         url     := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/send-push',
--         headers := jsonb_build_object(
--                      'Content-Type','application/json',
--                      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')),
--         body    := jsonb_build_object(
--                      'user_ids', (select coalesce(array_agg(distinct owner_id), '{}') from fired),
--                      'title','Note reminder',
--                      'body','You have a paid-collab note reminder due',
--                      'link','/paid-collab','tag','note-reminder')
--       ) where exists (select 1 from fired);
--     $cron$
--   );
--
-- Until pg_cron is enabled, reminders still surface in-app: the
-- front-end calls fire_due_note_reminders() on load + on an
-- interval, so an open session converts due reminders into
-- realtime notifications.
-- =========================================================
