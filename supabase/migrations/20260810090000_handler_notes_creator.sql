-- =========================================================
-- Afflix Core — creator-wise Keep notes (paid-collab workspace)
--
-- Keep-style notes can already link to a brand ("brand-wise") and a
-- month ("program-wise"). Add an optional CREATOR link: a note attaches
-- to one handler_collab_creators row (a deal). Deleting the deal keeps
-- the note (set null), matching brand_id. RLS is untouched — notes stay
-- owner-scoped, the creator link is just metadata on the owner's note.
--
-- The front-end groups creator notes by "the same creator" across months
-- within a brand (identity = handle, else name — the repo convention),
-- so the journal icon next to a creator's name follows them month to month.
--
-- fire_due_note_reminders() is re-created ONLY to carry creator_id in the
-- notification payload; links stay as set by 20260807090000.
--
-- Applied manually via Supabase SQL editor / `supabase db push`.
-- =========================================================

alter table public.handler_notes
  add column if not exists creator_id uuid
    references public.handler_collab_creators(id) on delete set null;

create index if not exists handler_notes_creator_idx
  on public.handler_notes(creator_id)
  where creator_id is not null;

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
    select hn.id, hn.owner_id, hn.title, hn.body, hn.brand_id, hn.creator_id, hn.month,
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
           jsonb_build_object('note_id', id, 'brand_id', brand_id, 'creator_id', creator_id, 'month', month)
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
