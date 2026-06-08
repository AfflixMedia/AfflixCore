-- =========================================================
-- Afflix Core — Global Chat: announcement @-mentions
--
-- In the announcement channel the admin can now @-mention any internal staff
-- member (front-end picks the roster from the role-based staff list). This makes
-- the message trigger give mentioned people a dedicated "mentioned you"
-- notification, while everyone else still gets the normal announcement ping.
-- =========================================================

create or replace function public.chat_on_new_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
  preview text;
  is_ann boolean;
  conv_title text;
begin
  update public.chat_conversations
     set last_message_at = new.created_at
   where id = new.conversation_id
   returning is_announcement, title into is_ann, conv_title;

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
      join public.profiles p on p.id = u and p.role in ('bob','apc','paid_collab_handler')
      where u <> new.sender_id;
    end if;

    -- Everyone else (not the sender, not already mentioned) gets the announcement.
    insert into public.notifications (user_id, type, title, body, link, payload)
    select p.id, 'chat', coalesce(conv_title, 'Announcements'),
           left(coalesce(sender_name, '') || ': ' || preview, 180),
           '/chats?c=' || new.conversation_id::text,
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                              'sender_id', new.sender_id, 'announcement', true)
    from public.profiles p
    where p.role in ('bob','apc','paid_collab_handler') and p.id <> new.sender_id
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
    where u <> new.sender_id;
  end if;

  -- Everyone else in the conversation gets a normal chat notification.
  insert into public.notifications (user_id, type, title, body, link, payload)
  select pt.user_id, 'chat', coalesce(sender_name, 'New message'), preview,
         '/chats?c=' || new.conversation_id::text,
         jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                            'sender_id', new.sender_id)
  from public.chat_participants pt
  where pt.conversation_id = new.conversation_id
    and pt.user_id <> new.sender_id
    and pt.left_at is null
    and not (new.mentions is not null and pt.user_id = any(new.mentions));

  return new;
end;
$$;
