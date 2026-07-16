-- =========================================================
-- Afflix Core — Chat attachments (images / videos on Google Drive)
--
-- chat_messages gains an `attachment jsonb` column:
--   { kind: 'image'|'video'|'file', drive_id, name, mime, size, url }
-- The FILE BYTES live in a Google Drive folder (uploaded through the
-- `chat-drive-upload` edge function with the company Google account's OAuth
-- refresh token) — NOT in Supabase Storage. The message row only stores the
-- Drive file id + public links, so all existing chat RLS keeps working.
--
-- Also re-created here:
--   • chat_attachment_label(jsonb)  — "📷 Photo" / "🎥 Video" / "📎 name"
--   • chat_on_new_message           — notification preview for media-only
--                                     messages (base: 20260814 mention-only)
--   • chat_overview                 — list preview for media-only messages
--                                     (base: 20260612 phase-4 version)
--   • chat_delete_message           — tombstone also clears the attachment
--
-- Apply with: supabase db push  (or paste into the SQL editor)
-- =========================================================

alter table public.chat_messages
  add column if not exists attachment jsonb;

-- ---------- Preview label for an attachment ----------
create or replace function public.chat_attachment_label(a jsonb)
returns text
language sql
immutable
as $$
  select case
    when a is null then null
    when a->>'kind' = 'image' then '📷 Photo'
    when a->>'kind' = 'video' then '🎥 Video'
    else '📎 ' || coalesce(nullif(a->>'name', ''), 'File')
  end;
$$;

-- ---------- Notifications: media-only messages get a readable preview ----------
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
  preview := left(coalesce(
    nullif(new.body, ''),
    public.chat_attachment_label(new.attachment),
    ''), 140);

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

-- ---------- Overview: media-only messages preview as "📷 Photo" etc. ----------
create or replace function public.chat_overview()
returns table (
  conversation_id uuid,
  last_body text,
  last_sender_id uuid,
  last_at timestamptz,
  unread bigint
)
language sql stable security definer set search_path = public as $$
  with mine as (
    select conversation_id, last_read_at, history_from, left_at
    from public.chat_participants
    where user_id = auth.uid()
  ),
  scope as (
    select conversation_id, last_read_at, history_from, left_at from mine
    union
    -- The announcement, for staff who have no participant row yet.
    select c.id, '-infinity'::timestamptz, null::timestamptz, null::timestamptz
    from public.chat_conversations c
    where c.is_announcement and public.is_internal_staff()
      and not exists (select 1 from mine where mine.conversation_id = c.id)
  ),
  last_msg as (
    select distinct on (m.conversation_id)
      m.conversation_id,
      coalesce(nullif(m.body, ''), public.chat_attachment_label(m.attachment)) as body,
      m.sender_id, m.created_at
    from public.chat_messages m
    join scope s on s.conversation_id = m.conversation_id
    where m.deleted_at is null
      and (s.history_from is null or m.created_at >= s.history_from)
      and (s.left_at is null or m.created_at <= s.left_at)
    order by m.conversation_id, m.created_at desc
  ),
  unread as (
    select m.conversation_id, count(*)::bigint as cnt
    from public.chat_messages m
    join scope s on s.conversation_id = m.conversation_id
    where s.left_at is null                              -- archived → nothing actionable
      and m.created_at > coalesce(s.last_read_at, '-infinity'::timestamptz)
      and m.sender_id <> auth.uid()
      and m.deleted_at is null
      and (s.history_from is null or m.created_at >= s.history_from)
    group by m.conversation_id
  )
  select scope.conversation_id,
         last_msg.body, last_msg.sender_id, last_msg.created_at,
         coalesce(unread.cnt, 0)
  from scope
  left join last_msg on last_msg.conversation_id = scope.conversation_id
  left join unread   on unread.conversation_id  = scope.conversation_id;
$$;
revoke all on function public.chat_overview() from public;
grant execute on function public.chat_overview() to authenticated;

-- ---------- Delete for everyone: also drop the attachment reference ----------
-- (The Drive file itself is not deleted — the message just stops pointing at
-- it. Cleaning the Drive folder is a manual/ops concern.)
create or replace function public.chat_delete_message(p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare snd uuid;
begin
  select sender_id into snd from public.chat_messages where id = p_msg;
  if snd is null or snd <> auth.uid() then
    raise exception 'can only delete your own message';
  end if;
  update public.chat_messages
     set deleted_at = now(), body = '', mentions = null, attachment = null
   where id = p_msg;
end;
$$;
revoke all on function public.chat_delete_message(uuid) from public;
grant execute on function public.chat_delete_message(uuid) to authenticated;
