-- =========================================================
-- Afflix Core — Fix user deletion, part 3 (chat membership log trigger)
--
-- The real remaining cause of "Database error deleting user": when an
-- account is deleted, its chat_participants rows CASCADE-delete, and
-- chat_log_participant's DELETE branch inserts a chat_membership_log row
-- with target_id = the user being deleted. Inside GoTrue's transaction the
-- auth.users row is already gone, so that insert violates
-- chat_membership_log.target_id's FK and aborts the whole account delete.
--
-- Since 20260716 every brand-assigned APC / internal handler / Team Lead is
-- auto-member of their brand's chat group, so practically every active
-- account tripped this.
--
-- Fix: in the DELETE branch, only log when the member still exists in
-- auth.users (normal UI removals are SOFT — left_at update — and unaffected;
-- a hard participant delete only happens on account deletion, where a
-- "left" line is meaningless anyway).
--
-- Body otherwise identical to 20260612090000_chat_phase4.sql.
-- =========================================================

create or replace function public.chat_log_participant()
returns trigger language plpgsql security definer set search_path = public as $$
declare g boolean; ann boolean; creator uuid;
begin
  if TG_OP = 'INSERT' then
    select is_group, is_announcement, created_by into g, ann, creator
      from public.chat_conversations where id = new.conversation_id;
    if g and not ann then
      insert into public.chat_membership_log(conversation_id, actor_id, target_id, action)
      values (new.conversation_id, auth.uid(), new.user_id,
        case when auth.uid() = new.user_id
             then case when creator = new.user_id then 'created' else 'joined' end
             else 'added' end);
    end if;
    return new;

  elsif TG_OP = 'DELETE' then
    select is_group, is_announcement into g, ann
      from public.chat_conversations where id = old.conversation_id;
    -- Skip logging when the row is cascading away because the USER is being
    -- deleted (their auth.users row is already gone in this transaction).
    if g and not ann
       and exists (select 1 from auth.users u where u.id = old.user_id) then
      insert into public.chat_membership_log(conversation_id, actor_id, target_id, action)
      values (old.conversation_id, auth.uid(), old.user_id,
        case when auth.uid() = old.user_id then 'left' else 'removed' end);
    end if;
    return old;

  elsif TG_OP = 'UPDATE' then
    select is_group, is_announcement into g, ann
      from public.chat_conversations where id = new.conversation_id;
    if g and not ann then
      if new.left_at is not null and old.left_at is null then           -- left / removed
        insert into public.chat_membership_log(conversation_id, actor_id, target_id, action)
        values (new.conversation_id, auth.uid(), new.user_id,
          case when auth.uid() = new.user_id then 'left' else 'removed' end);
      elsif new.left_at is null and old.left_at is not null then        -- re-added
        insert into public.chat_membership_log(conversation_id, actor_id, target_id, action)
        values (new.conversation_id, auth.uid(), new.user_id,
          case when auth.uid() = new.user_id then 'joined' else 'added' end);
      elsif new.is_admin is distinct from old.is_admin then             -- admin change
        insert into public.chat_membership_log(conversation_id, actor_id, target_id, action)
        values (new.conversation_id, auth.uid(), new.user_id,
          case when new.is_admin then 'promoted' else 'demoted' end);
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;
