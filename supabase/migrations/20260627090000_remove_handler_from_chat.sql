-- =========================================================
-- Afflix Core — Remove Paid Collab Handlers from Global Chat
--
-- Product decision: the paid_collab_handler role should no longer have any
-- access to the internal team Chats feature (no nav, no contacts, can't be
-- DM'd / added to groups, no announcement, no chat notifications).
--
-- is_internal_staff() is effectively a chat-only gate (it is referenced only by
-- the chat migrations 20260608–20260617), so dropping paid_collab_handler from
-- it cleanly cascades through every chat RLS read/write policy and the
-- announcement roster. We also strip the role from the explicit roster filters
-- in the SECURITY DEFINER functions so handlers can't appear as contacts, be
-- added, or receive chat / announcement / mention notifications.
--
-- Bodies are reproduced verbatim from their latest definitions
-- (20260616090000 for is_internal_staff, 20260617090000 for the rest); the ONLY
-- change is removing 'paid_collab_handler' from the role lists, plus an extra
-- guard so any lingering handler participant rows in old groups stop getting
-- normal chat notifications.
-- =========================================================

-- ---------- is_internal_staff (from 20260616) ----------
create or replace function public.is_internal_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('bob', 'team_lead', 'apc')
  );
$$;

-- ---------- chat_list_contacts (from 20260617) ----------
create or replace function public.chat_list_contacts()
returns table (id uuid, full_name text, email text, role text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role
  from public.profiles p
  where p.role in ('bob', 'team_lead', 'apc')
    and p.id <> auth.uid()
    and public.is_internal_staff();
$$;

-- ---------- chat_get_or_create_dm (from 20260617) ----------
create or replace function public.chat_get_or_create_dm(other_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k text;
  conv uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user is null or other_user = me then raise exception 'invalid target user'; end if;
  if not public.is_internal_staff() then raise exception 'not allowed'; end if;
  if not exists (
    select 1 from public.profiles
    where id = other_user and role in ('bob', 'team_lead', 'apc')
  ) then
    raise exception 'target user is not internal staff';
  end if;

  k := case when me < other_user
            then me::text || ':' || other_user::text
            else other_user::text || ':' || me::text end;

  insert into public.chat_conversations (is_group, dm_key, created_by)
  values (false, k, me)
  on conflict (dm_key) do nothing;

  select id into conv from public.chat_conversations where dm_key = k;

  insert into public.chat_participants (conversation_id, user_id)
  values (conv, me), (conv, other_user)
  on conflict do nothing;

  return conv;
end;
$$;

-- ---------- chat_create_group (from 20260617) ----------
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
                           where id = m and role in ('bob','team_lead','apc')) then
      insert into public.chat_participants (conversation_id, user_id) values (conv, m)
      on conflict do nothing;
    end if;
  end loop;
  return conv;
end;
$$;

-- ---------- chat_add_member (3-arg, from 20260617) ----------
create or replace function public.chat_add_member(p_conv uuid, p_user uuid, p_show_history boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare hist timestamptz;
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('bob','team_lead','apc')) then
    raise exception 'target is not internal staff';
  end if;
  hist := case when p_show_history then null else now() end;
  if exists (select 1 from public.chat_participants where conversation_id = p_conv and user_id = p_user) then
    update public.chat_participants
      set left_at = null, joined_at = now(), is_admin = false,
          history_from = hist, last_read_at = now()
      where conversation_id = p_conv and user_id = p_user;
  else
    insert into public.chat_participants (conversation_id, user_id, history_from)
    values (p_conv, p_user, hist);
  end if;
end;
$$;

-- ---------- chat_on_new_message (from 20260617) ----------
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
      join public.profiles p on p.id = u and p.role in ('bob','team_lead','apc')
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
    where p.role in ('bob','team_lead','apc') and p.id <> new.sender_id
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
    join public.profiles p on p.id = u and p.role in ('bob','team_lead','apc')
    where u <> new.sender_id;
  end if;

  -- Everyone else in the conversation gets a normal chat notification.
  -- (Handlers are excluded even if a lingering participant row remains from a
  -- group they were in before chat access was revoked.)
  insert into public.notifications (user_id, type, title, body, link, payload)
  select pt.user_id, 'chat', coalesce(sender_name, 'New message'), preview,
         '/chats?c=' || new.conversation_id::text,
         jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id,
                            'sender_id', new.sender_id)
  from public.chat_participants pt
  join public.profiles p on p.id = pt.user_id and p.role in ('bob','team_lead','apc')
  where pt.conversation_id = new.conversation_id
    and pt.user_id <> new.sender_id
    and pt.left_at is null
    and not (new.mentions is not null and pt.user_id = any(new.mentions));

  return new;
end;
$$;
