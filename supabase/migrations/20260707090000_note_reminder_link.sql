-- =========================================================
-- Afflix Core — make note-reminder notifications deep-link to
-- the specific note. The handler workspace reads ?note=<id>
-- and opens that note's editor.
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
           '/paid-collab?note=' || id::text,
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
