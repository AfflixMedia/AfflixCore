-- =========================================================
-- Afflix Core — Global Chat phase 4
--
--  1. Creator who LEAVES loses ownership/admin. On a creator leaving, ownership
--     (created_by) + admin transfer to an active remaining member, so a re-added
--     creator comes back as a plain member until promoted.
--  2. Announcement preview + unread now show for every internal staff member,
--     even before they've opened it (chat_overview includes the announcement).
--  6. Archive + history control. Leaving / being removed is now a SOFT leave
--     (chat_participants.left_at) — the conversation stays visible read-only in an
--     Archive tab; the ex-member can't send or receive new messages. Admins adding
--     a member choose whether that member can see prior history (history_from).
--
-- Additive / idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, policy
-- re-creates. Server assigns all timestamps.
-- =========================================================

-- ---------- New columns ----------
-- left_at:      null = active member; set = archived (left or removed).
-- history_from: null = full history;  set = only messages at/after this instant.
alter table public.chat_participants add column if not exists left_at      timestamptz;
alter table public.chat_participants add column if not exists history_from  timestamptz;

-- =====================================================================
-- Membership helpers — split "active member" from "can view (read-only)".
-- =====================================================================
-- Active member: drives sending, roster, notifications, admin checks.
create or replace function public.is_chat_member(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants
    where conversation_id = conv and user_id = auth.uid() and left_at is null
  );
$$;

-- Viewer: any participant row (active OR archived) — or announcement+staff.
-- Read access to conversation / participants / log / reactions / bookmarks so
-- archived members keep their read-only history.
create or replace function public.is_chat_viewer(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants
    where conversation_id = conv and user_id = auth.uid()
  ) or exists (
    select 1 from public.chat_conversations c
    where c.id = conv and c.is_announcement and public.is_internal_staff()
  );
$$;
revoke all on function public.is_chat_viewer(uuid) from public;
grant execute on function public.is_chat_viewer(uuid) to authenticated;

-- Admin / creator now require an ACTIVE row, so a departed creator stops being
-- admin even if created_by still pointed at them mid-transaction.
create or replace function public.is_chat_admin(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants p
    where p.conversation_id = conv and p.user_id = auth.uid() and p.left_at is null
      and (p.is_admin
           or (select created_by from public.chat_conversations c where c.id = conv) = auth.uid())
  );
$$;

create or replace function public.is_chat_creator(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_conversations c
    join public.chat_participants p
      on p.conversation_id = c.id and p.user_id = auth.uid() and p.left_at is null
    where c.id = conv and c.created_by = auth.uid()
  );
$$;

-- Per-message visibility: honours history_from (hidden prior history) and left_at
-- (archived members are frozen at the moment they left). announcement+staff read all.
create or replace function public.can_read_message(conv uuid, msg_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_participants p
    where p.conversation_id = conv and p.user_id = auth.uid()
      and (p.history_from is null or msg_at >= p.history_from)
      and (p.left_at is null or msg_at <= p.left_at)
  ) or exists (
    select 1 from public.chat_conversations c
    where c.id = conv and c.is_announcement and public.is_internal_staff()
  );
$$;
revoke all on function public.can_read_message(uuid, timestamptz) from public;
grant execute on function public.can_read_message(uuid, timestamptz) to authenticated;

-- =====================================================================
-- RLS — readers use the viewer/per-message helpers; writers stay active-only.
-- =====================================================================
drop policy if exists "chat conv read" on public.chat_conversations;
create policy "chat conv read" on public.chat_conversations
  for select using (public.is_chat_viewer(id));

drop policy if exists "chat part read" on public.chat_participants;
create policy "chat part read" on public.chat_participants
  for select using (public.is_chat_viewer(conversation_id));

drop policy if exists "chat msg read" on public.chat_messages;
create policy "chat msg read" on public.chat_messages
  for select using (public.can_read_message(conversation_id, created_at));

-- Sending requires ACTIVE membership; announcement stays Bob-only.
drop policy if exists "chat msg insert" on public.chat_messages;
create policy "chat msg insert" on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_internal_staff()
    and public.is_chat_member(conversation_id)
    and (not public.is_announcement_conv(conversation_id) or public.is_bob())
  );

drop policy if exists "chat react read" on public.chat_message_reactions;
create policy "chat react read" on public.chat_message_reactions
  for select using (public.is_chat_viewer(conversation_id));
drop policy if exists "chat react insert" on public.chat_message_reactions;
create policy "chat react insert" on public.chat_message_reactions
  for insert with check (
    user_id = auth.uid() and public.is_internal_staff() and (
      public.is_chat_member(conversation_id) or public.is_announcement_conv(conversation_id)
    )
  );

drop policy if exists "chat bookmark read" on public.chat_bookmarks;
create policy "chat bookmark read" on public.chat_bookmarks
  for select using (public.is_chat_viewer(conversation_id));

drop policy if exists "chat log read" on public.chat_membership_log;
create policy "chat log read" on public.chat_membership_log
  for select using (public.is_chat_viewer(conversation_id));

-- =====================================================================
-- #1 + #6 — soft-leave bookkeeping: ownership transfer + ensure an admin.
-- Fires on a member going active -> inactive (DELETE, or UPDATE of left_at).
-- =====================================================================
create or replace function public.chat_ensure_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid; leaving uuid;
  g boolean; ann boolean; creator uuid;
  admin_count int; next_owner uuid; next_admin uuid;
begin
  if TG_OP = 'DELETE' then
    conv_id := old.conversation_id; leaving := old.user_id;
  elsif TG_OP = 'UPDATE' then
    -- Only act when a member becomes inactive; re-adds (set -> null) are ignored.
    if not (new.left_at is not null and old.left_at is null) then
      return new;
    end if;
    conv_id := new.conversation_id; leaving := new.user_id;
  else
    return new;
  end if;

  -- Lock the conversation so concurrent leaves serialize their decisions.
  select is_group, is_announcement, created_by into g, ann, creator
    from public.chat_conversations where id = conv_id for update;

  -- Only real groups need a guaranteed admin (DMs / the announcement don't).
  if g is null or not g or ann then
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;

  -- #1: the creator left → hand ownership to an active remaining member
  -- (prefer an existing admin, else the earliest-joined member) and make them
  -- admin. The original creator, if re-added later, comes back as a plain member.
  if leaving = creator then
    select user_id into next_owner
      from public.chat_participants
      where conversation_id = conv_id and left_at is null and user_id <> leaving and is_admin
      order by joined_at asc, user_id asc limit 1;
    if next_owner is null then
      select user_id into next_owner
        from public.chat_participants
        where conversation_id = conv_id and left_at is null and user_id <> leaving
        order by joined_at asc, user_id asc limit 1;
    end if;
    if next_owner is not null then
      update public.chat_conversations set created_by = next_owner where id = conv_id;
      update public.chat_participants set is_admin = true
        where conversation_id = conv_id and user_id = next_owner and not is_admin;
      creator := next_owner;
    end if;
  end if;

  -- Ensure at least one active admin remains (creator counts as admin).
  select count(*) into admin_count
    from public.chat_participants
    where conversation_id = conv_id and left_at is null and user_id <> leaving
      and (is_admin or user_id = creator);

  if admin_count = 0 then
    select user_id into next_admin
      from public.chat_participants
      where conversation_id = conv_id and left_at is null and user_id <> leaving
      order by joined_at asc, user_id asc limit 1;
    if next_admin is not null then
      update public.chat_participants set is_admin = true
        where conversation_id = conv_id and user_id = next_admin;
    end if;
  end if;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists chat_participants_ensure_admin on public.chat_participants;
create trigger chat_participants_ensure_admin
  after delete or update of left_at on public.chat_participants
  for each row execute function public.chat_ensure_admin();

-- =====================================================================
-- Membership log — also record soft leave / removal / re-add (UPDATE of left_at).
-- =====================================================================
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
    if g and not ann then
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
-- (trigger chat_participants_log from phase 3 already covers insert/update/delete)

-- =====================================================================
-- RPCs — soft leave / remove, add-with-history, self leave.
-- =====================================================================
-- Remove a member: soft leave (keeps history read-only for them).
create or replace function public.chat_remove_member(p_conv uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if p_user = (select created_by from public.chat_conversations where id = p_conv) then
    raise exception 'cannot remove the group creator';
  end if;
  update public.chat_participants
    set left_at = now()
    where conversation_id = p_conv and user_id = p_user and left_at is null;
end;
$$;

-- Add (or re-add) a member; p_show_history controls prior-history visibility.
drop function if exists public.chat_add_member(uuid, uuid);
create or replace function public.chat_add_member(p_conv uuid, p_user uuid, p_show_history boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare hist timestamptz;
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if not exists (select 1 from public.profiles where id = p_user and role in ('bob','apc','paid_collab_handler')) then
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

-- Leave a group: self soft-leave (the announcement can't be left).
create or replace function public.chat_leave_group(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_announcement_conv(p_conv) then raise exception 'cannot leave the announcement channel'; end if;
  update public.chat_participants
    set left_at = now()
    where conversation_id = p_conv and user_id = auth.uid() and left_at is null;
end;
$$;

revoke all on function public.chat_remove_member(uuid, uuid) from public;
revoke all on function public.chat_add_member(uuid, uuid, boolean) from public;
revoke all on function public.chat_leave_group(uuid) from public;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;
grant execute on function public.chat_add_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.chat_leave_group(uuid) to authenticated;

-- =====================================================================
-- #2 + #6 — overview: include the announcement for all staff; honour the
-- history_from / left_at bounds; archived rows report no unread.
-- =====================================================================
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
      m.conversation_id, m.body, m.sender_id, m.created_at
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

-- =====================================================================
-- Notifications — don't fan out to archived members.
-- =====================================================================
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
