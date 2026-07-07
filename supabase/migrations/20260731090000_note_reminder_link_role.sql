-- =========================================================
-- Afflix Core — make note-reminder notifications land on a page
-- the owner can actually open.
--
-- handler_notes is owner-scoped (any signed-in user keeps their own
-- Keep-style notes), so it now also backs the Ads Manager notes board.
-- The reminder fan-out hard-coded link '/paid-collab', which an
-- ads_manager has no access to. Re-create fire_due_note_reminders so the
-- link is role-aware: ads_manager owners get '/notes' (their board),
-- everyone else keeps '/paid-collab'.
-- Behaviour is otherwise identical to 20260706090000.
-- =========================================================

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
    select hn.id, hn.owner_id, hn.title, hn.body, hn.brand_id, hn.month,
           coalesce(p.role, '') as owner_role
    from public.handler_notes hn
    left join public.profiles p on p.id = hn.owner_id
    where hn.reminder_at is not null
      and hn.reminder_at <= now()
      and hn.reminder_sent_at is null
      and not hn.archived
      and not hn.reminder_done
    for update of hn skip locked
  ), ins as (
    insert into public.notifications (user_id, type, title, body, link, payload)
    select owner_id,
           'note_reminder',
           'Reminder: ' || coalesce(nullif(btrim(title), ''), 'Note'),
           left(nullif(btrim(body), ''), 160),
           case when owner_role = 'ads_manager' then '/notes' else '/paid-collab' end,
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
