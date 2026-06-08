-- =========================================================
-- Afflix Core — Global Chat: never leave a group without an admin.
--
-- When a participant leaves (or is removed from) a real group and no admin is
-- left — the creator counts as an admin — promote the earliest-joined remaining
-- member to admin so the group stays manageable. Runs server-side so it also
-- holds under concurrent leaves (the conversation row is locked to serialize).
-- =========================================================

create or replace function public.chat_ensure_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g boolean; ann boolean; creator uuid;
  admin_count int;
  next_admin uuid;
begin
  -- Lock the conversation row so two simultaneous leaves can't both decide
  -- "an admin still exists" and skip the promotion.
  select is_group, is_announcement, created_by into g, ann, creator
    from public.chat_conversations where id = old.conversation_id for update;

  -- Only real groups need a guaranteed admin (DMs / the announcement don't).
  if g is null or not g or ann then
    return old;
  end if;

  -- Any admin still present? The creator is always treated as an admin.
  select count(*) into admin_count
    from public.chat_participants
    where conversation_id = old.conversation_id
      and (is_admin or user_id = creator);

  if admin_count = 0 then
    select user_id into next_admin
      from public.chat_participants
      where conversation_id = old.conversation_id
      order by joined_at asc, user_id asc
      limit 1;                       -- earliest-joined remaining member
    if next_admin is not null then
      update public.chat_participants
        set is_admin = true
        where conversation_id = old.conversation_id and user_id = next_admin;
    end if;
  end if;
  return old;
end;
$$;

-- Fires before the membership-log trigger (alphabetical: ensure_admin < log),
-- so the promotion is reflected in the same transaction as the leave.
drop trigger if exists chat_participants_ensure_admin on public.chat_participants;
create trigger chat_participants_ensure_admin
  after delete on public.chat_participants
  for each row execute function public.chat_ensure_admin();
