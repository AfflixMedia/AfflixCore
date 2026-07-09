-- =========================================================
-- Afflix Core — role-aware note-reminder links, part 2.
--
-- Keep-style notes now also belong to Bob / Team Lead / APC: they get a
-- personal owner-only board at '/my-notes' (+ the app-wide floating notes
-- button in own-notes mode). Point their note-reminder notifications there.
-- ads_manager keeps '/notes' (their board, may include shared boss notes);
-- everyone else (paid_collab_handler) keeps '/paid-collab' (the handler
-- workspace Notes tab). Behaviour otherwise identical to 20260731090000.
--
-- Applied manually via Supabase SQL editor / `supabase db push`.
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
           case
             when owner_role = 'ads_manager' then '/notes'
             when owner_role in ('bob', 'team_lead', 'apc') then '/my-notes'
             else '/paid-collab'
           end,
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
