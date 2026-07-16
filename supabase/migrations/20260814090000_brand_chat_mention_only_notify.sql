-- =========================================================
-- Afflix Core — Brand chat groups: mention-only notifications
--
-- In a BRAND group (chat_conversations.brand_id is set) a new message only
-- notifies the members who were @-mentioned (their 'chat_mention'
-- notification). Everyone else receives the message silently: it still
-- appears in the stream + bumps the conversation's own unread counter
-- (chat_overview compares last_read_at), but NO 'chat' notification row is
-- created — no bell entry, no sidebar Chats badge, no push.
--
-- DMs, normal groups, and the announcement channel keep the full fan-out.
--
-- Re-creates chat_on_new_message (last re-created in 20260717) with a
-- conv_brand arm around the "everyone else" insert.
-- Apply with: supabase db push  (or paste into the SQL editor)
-- =========================================================

create or replace function public.chat_on_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
  preview text;
  is_ann boolean;
  conv_title text;
  conv_brand uuid;
begin
  update public.chat_conversations
     set last_message_at = new.created_at
   where id = new.conversation_id
   returning is_announcement, title, brand_id into is_ann, conv_title, conv_brand;

  select coalesce(nullif(full_name, ''), email) into sender_name
    from public.profiles where id = new.sender_id;
  preview := left(coalesce(new.body, ''), 140);

  if is_ann then
    -- Mentioned staff get a dedicated "mentioned you" notification.
    if new.mentions is not null and array_length(new.mentions, 1) > 0 then
      insert into public.notifications (user_id, type, title, body, link, payload)
      select u, 'chat_mention',
             coalesce(sender_name, 'Someone') || ' mentioned you in '
               || coalesce(conv_title, 'Announcements'),
             preview, '/chats?c=' || new.conversation_id::text,
             jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                                'sender_id', new.sender_id, 'announcement', true, 'mention', true)
      from unnest(new.mentions) as u
      where public.is_chat_staff(u)
        and u <> new.sender_id;
    end if;

    -- Everyone else (not the sender, not already mentioned) gets the announcement.
    insert into public.notifications (user_id, type, title, body, link, payload)
    select p.id, 'chat', coalesce(conv_title, 'Announcements'),
           left(coalesce(sender_name, '') || ': ' || preview, 180),
           '/chats?c=' || new.conversation_id::text,
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                              'sender_id', new.sender_id, 'announcement', true)
    from public.profiles p
    where public.is_chat_staff(p.id) and p.id <> new.sender_id
      and not (new.mentions is not null and p.id = any(new.mentions));
    return new;
  end if;

  -- Mentioned users get a dedicated "mentioned you" notification.
  if new.mentions is not null and array_length(new.mentions, 1) > 0 then
    insert into public.notifications (user_id, type, title, body, link, payload)
    select u, 'chat_mention',
           coalesce(sender_name, 'Someone') || ' mentioned you'
             || case when conv_title is not null then ' in ' || conv_title else '' end,
           preview, '/chats?c=' || new.conversation_id::text,
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                              'sender_id', new.sender_id, 'mention', true)
    from unnest(new.mentions) as u
    where public.is_chat_staff(u)
      and u <> new.sender_id;
  end if;

  -- Everyone else in the conversation gets a normal chat notification —
  -- EXCEPT in brand groups, where non-mentioned members receive the message
  -- silently (unread counter only, no notification).
  if conv_brand is null then
    insert into public.notifications (user_id, type, title, body, link, payload)
    select pt.user_id, 'chat', coalesce(sender_name, 'New message'), preview,
           '/chats?c=' || new.conversation_id::text,
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                              'sender_id', new.sender_id)
    from public.chat_participants pt
    where pt.conversation_id = new.conversation_id
      and public.is_chat_staff(pt.user_id)
      and pt.user_id <> new.sender_id
      and pt.left_at is null
      and not (new.mentions is not null and pt.user_id = any(new.mentions));
  end if;

  return new;
end;
$$;
