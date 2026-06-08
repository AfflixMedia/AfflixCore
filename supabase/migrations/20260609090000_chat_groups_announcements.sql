-- =========================================================
-- Afflix Core — Global Chat phase 2: groups, mentions, announcement channel.
--
--  * Groups: creator + designated admins can rename / add / remove members.
--  * @mentions: chat_messages.mentions uuid[]; mentioned users get a
--    'chat_mention' notification.
--  * Announcement channel: a single is_announcement conversation. Any internal
--    staff can READ it (role-based RLS — so new employees see it automatically);
--    only Bob can POST. Read-state tracked via a lazily-created participant row.
-- =========================================================

-- ---------- New columns (all on chat_* tables added in phase 1) ----------
alter table public.chat_conversations add column if not exists is_announcement boolean not null default false;
alter table public.chat_participants  add column if not exists is_admin boolean not null default false;
alter table public.chat_messages      add column if not exists mentions uuid[];

-- Only one announcement conversation can ever exist.
create unique index if not exists chat_one_announcement
  on public.chat_conversations ((true)) where is_announcement;

-- ---------- Group-admin helpers (SECURITY DEFINER → no RLS recursion) ----------
create or replace function public.is_chat_admin(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_conversations c where c.id = conv and c.created_by = auth.uid())
      or exists (select 1 from public.chat_participants p
                 where p.conversation_id = conv and p.user_id = auth.uid() and p.is_admin);
$$;

create or replace function public.is_chat_creator(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_conversations c where c.id = conv and c.created_by = auth.uid());
$$;

create or replace function public.is_announcement_conv(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_conversations c where c.id = conv and c.is_announcement);
$$;

-- ---------- Revised RLS ----------
-- conversations: members read; internal staff also read the announcement.
drop policy if exists "chat conv read" on public.chat_conversations;
create policy "chat conv read" on public.chat_conversations
  for select using (
    public.is_chat_member(id)
    or (is_announcement and public.is_internal_staff())
  );

-- conversations: group/announcement admins can rename.
drop policy if exists "chat conv update" on public.chat_conversations;
create policy "chat conv update" on public.chat_conversations
  for update using (public.is_chat_admin(id)) with check (public.is_chat_admin(id));

-- participants: admins add members; a user may self-join the announcement.
drop policy if exists "chat part add" on public.chat_participants;
create policy "chat part add" on public.chat_participants
  for insert with check (
    public.is_internal_staff() and (
      public.is_chat_admin(conversation_id)
      or (user_id = auth.uid() and public.is_announcement_conv(conversation_id))
    )
  );

-- participants: admins remove anyone but the creator; a user can leave.
drop policy if exists "chat part remove" on public.chat_participants;
create policy "chat part remove" on public.chat_participants
  for delete using (
    (public.is_chat_admin(conversation_id)
      and user_id <> (select created_by from public.chat_conversations where id = conversation_id))
    or user_id = auth.uid()
  );

-- messages: members read; internal staff also read the announcement.
drop policy if exists "chat msg read" on public.chat_messages;
create policy "chat msg read" on public.chat_messages
  for select using (
    public.is_chat_member(conversation_id)
    or (public.is_announcement_conv(conversation_id) and public.is_internal_staff())
  );

-- messages: sender posts their own; in the announcement only Bob may post.
drop policy if exists "chat msg insert" on public.chat_messages;
create policy "chat msg insert" on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_internal_staff()
    and public.is_chat_member(conversation_id)
    and (not public.is_announcement_conv(conversation_id) or public.is_bob())
  );

-- ---------- RPC: create a group ----------
create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv uuid;
  m uuid;
begin
  if not public.is_internal_staff() then raise exception 'not allowed'; end if;
  insert into public.chat_conversations (is_group, title, created_by)
  values (true, nullif(btrim(p_title), ''), me)
  returning id into conv;
  insert into public.chat_participants (conversation_id, user_id, is_admin)
  values (conv, me, true);
  foreach m in array coalesce(p_members, '{}') loop
    if m <> me and exists (select 1 from public.profiles
                           where id = m and role in ('bob','apc','paid_collab_handler')) then
      insert into public.chat_participants (conversation_id, user_id) values (conv, m)
      on conflict do nothing;
    end if;
  end loop;
  return conv;
end;
$$;

-- ---------- RPC: add / remove members, set admin, rename ----------
create or replace function public.chat_add_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('bob','apc','paid_collab_handler')) then
    raise exception 'target is not internal staff';
  end if;
  insert into public.chat_participants (conversation_id, user_id) values (p_conv, p_user)
  on conflict do nothing;
end;
$$;

create or replace function public.chat_remove_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if p_user = (select created_by from public.chat_conversations where id = p_conv) then
    raise exception 'cannot remove the group creator';
  end if;
  delete from public.chat_participants where conversation_id = p_conv and user_id = p_user;
end;
$$;

create or replace function public.chat_set_admin(p_conv uuid, p_user uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_creator(p_conv) then raise exception 'only the creator can change admins'; end if;
  update public.chat_participants set is_admin = p_is_admin
  where conversation_id = p_conv and user_id = p_user;
end;
$$;

create or replace function public.chat_rename(p_conv uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  update public.chat_conversations set title = nullif(btrim(p_title), '') where id = p_conv;
end;
$$;

-- ---------- RPC: get-or-create the announcement channel (Bob only) ----------
create or replace function public.chat_get_or_create_announcement()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  conv uuid;
begin
  if not public.is_bob() then raise exception 'only admin can manage announcements'; end if;
  select id into conv from public.chat_conversations where is_announcement limit 1;
  if conv is null then
    insert into public.chat_conversations (is_group, is_announcement, title, created_by)
    values (true, true, 'Announcements', me)
    returning id into conv;
  end if;
  insert into public.chat_participants (conversation_id, user_id, is_admin)
  values (conv, me, true) on conflict do nothing;
  return conv;
end;
$$;

revoke all on function public.chat_create_group(text, uuid[]) from public;
revoke all on function public.chat_add_member(uuid, uuid) from public;
revoke all on function public.chat_remove_member(uuid, uuid) from public;
revoke all on function public.chat_set_admin(uuid, uuid, boolean) from public;
revoke all on function public.chat_rename(uuid, text) from public;
revoke all on function public.chat_get_or_create_announcement() from public;
grant execute on function public.chat_create_group(text, uuid[]) to authenticated;
grant execute on function public.chat_add_member(uuid, uuid) to authenticated;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;
grant execute on function public.chat_set_admin(uuid, uuid, boolean) to authenticated;
grant execute on function public.chat_rename(uuid, text) to authenticated;
grant execute on function public.chat_get_or_create_announcement() to authenticated;

-- ---------- Notify trigger: mentions + announcement fan-out ----------
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
    -- Announcement: notify every internal staff member except the sender.
    insert into public.notifications (user_id, type, title, body, link, payload)
    select p.id, 'chat', coalesce(conv_title, 'Announcements'),
           left(coalesce(sender_name, '') || ': ' || preview, 180),
           '/chats?c=' || new.conversation_id::text,
           jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                              'sender_id', new.sender_id, 'announcement', true)
    from public.profiles p
    where p.role in ('bob','apc','paid_collab_handler') and p.id <> new.sender_id;
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
    and not (new.mentions is not null and pt.user_id = any(new.mentions));

  return new;
end;
$$;
