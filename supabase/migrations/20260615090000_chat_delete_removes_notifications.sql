-- =========================================================
-- Afflix Core — Global Chat: delete-for-everyone removes notifications
--
-- When a sender tombstones their message via chat_delete_message() the
-- `notifications` rows that were fanned out on INSERT still exist, so
-- recipients still see the notification in their bell even though the
-- message body has been wiped.
--
-- Fix: an AFTER UPDATE OF deleted_at trigger on chat_messages deletes
-- every notification whose payload->>'message_id' matches the deleted
-- message id. This runs server-side so it happens atomically with the
-- tombstone update.
-- =========================================================

create or replace function public.chat_on_message_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only act when deleted_at transitions from NULL → a timestamp.
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.notifications
    where payload->>'message_id' = new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_after_delete on public.chat_messages;
create trigger chat_messages_after_delete
  after update of deleted_at on public.chat_messages
  for each row execute function public.chat_on_message_deleted();
