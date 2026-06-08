-- =========================================================
-- Afflix Core — Global Chat phase 3
--
--  1. Leave group        — already permitted by the phase-2 self-remove RLS;
--                          logged by the membership trigger below.
--  2. Membership log      — added / joined / left / removed / promoted / demoted,
--                          shown inline as system lines.
--  3. Announcement count  — frontend only (total internal staff); no DB change.
--  4. Delete message      — "for everyone" (tombstone) + "for me" (per-user hide).
--  5. Ack reactions       — emoji acknowledgements on announcement messages, with
--                          a defined meaning per emoji and a visible reactor list.
--  6. Bookmarks           — per-conversation saved links with role-based edit access.
--
-- Adds NEW tables / functions / additive columns only. Existing non-chat tables
-- are untouched. Server assigns all timestamps.
-- =========================================================

-- =====================================================================
-- 2. Membership activity log
-- =====================================================================
create table if not exists public.chat_membership_log (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  actor_id  uuid references auth.users(id) on delete set null,   -- who performed it
  target_id uuid references auth.users(id) on delete set null,   -- who was affected
  action text not null,   -- created | added | joined | left | removed | promoted | demoted
  created_at timestamptz not null default now()
);
create index if not exists chat_membership_log_conv_idx
  on public.chat_membership_log(conversation_id, created_at);

alter table public.chat_membership_log enable row level security;
drop policy if exists "chat log read" on public.chat_membership_log;
create policy "chat log read" on public.chat_membership_log
  for select using (public.is_chat_member(conversation_id));
-- Inserts happen only via the SECURITY DEFINER trigger (no direct write grant).
grant select on public.chat_membership_log to authenticated;

-- Auto-log membership changes on real groups (not DMs, not the announcement).
create or replace function public.chat_log_participant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g boolean; ann boolean; creator uuid;
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
    if new.is_admin is distinct from old.is_admin then
      select is_group, is_announcement into g, ann
        from public.chat_conversations where id = new.conversation_id;
      if g and not ann then
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

drop trigger if exists chat_participants_log on public.chat_participants;
create trigger chat_participants_log
  after insert or update or delete on public.chat_participants
  for each row execute function public.chat_log_participant();

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='chat_membership_log') then
    alter publication supabase_realtime add table public.chat_membership_log;
  end if;
end $$;

-- =====================================================================
-- 4. Delete message
-- =====================================================================
-- "Delete for me" — per-user hidden rows (the message stays for everyone else).
create table if not exists public.chat_message_hidden (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists chat_message_hidden_user_idx
  on public.chat_message_hidden(user_id, conversation_id);
alter table public.chat_message_hidden enable row level security;
drop policy if exists "chat hidden self" on public.chat_message_hidden;
create policy "chat hidden self" on public.chat_message_hidden
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on public.chat_message_hidden to authenticated;

-- "Delete for everyone" — tombstone the sender's own message.
create or replace function public.chat_delete_message(p_msg uuid)
returns void language plpgsql security definer set search_path = public as $$
declare snd uuid;
begin
  select sender_id into snd from public.chat_messages where id = p_msg;
  if snd is null or snd <> auth.uid() then
    raise exception 'can only delete your own message';
  end if;
  update public.chat_messages
     set deleted_at = now(), body = '', mentions = null
   where id = p_msg;
end;
$$;
revoke all on function public.chat_delete_message(uuid) from public;
grant execute on function public.chat_delete_message(uuid) to authenticated;

-- =====================================================================
-- 5. Acknowledgement reactions
-- =====================================================================
-- One reaction per (message, user): re-acting changes the emoji, clicking the
-- same one again removes it (handled client-side). conversation_id is stored so
-- RLS / realtime can scope without a join back to chat_messages.
create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists chat_reactions_msg_idx  on public.chat_message_reactions(message_id);
create index if not exists chat_reactions_conv_idx on public.chat_message_reactions(conversation_id);
alter table public.chat_message_reactions enable row level security;

drop policy if exists "chat react read" on public.chat_message_reactions;
create policy "chat react read" on public.chat_message_reactions
  for select using (
    public.is_chat_member(conversation_id)
    or (public.is_announcement_conv(conversation_id) and public.is_internal_staff())
  );
drop policy if exists "chat react insert" on public.chat_message_reactions;
create policy "chat react insert" on public.chat_message_reactions
  for insert with check (
    user_id = auth.uid() and public.is_internal_staff() and (
      public.is_chat_member(conversation_id)
      or public.is_announcement_conv(conversation_id)
    )
  );
drop policy if exists "chat react update" on public.chat_message_reactions;
create policy "chat react update" on public.chat_message_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "chat react delete" on public.chat_message_reactions;
create policy "chat react delete" on public.chat_message_reactions
  for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.chat_message_reactions to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='chat_message_reactions') then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;

-- =====================================================================
-- 6. Bookmarks (saved links per conversation)
-- =====================================================================
alter table public.chat_conversations
  add column if not exists bookmarks_members_can_edit boolean not null default false;

create table if not exists public.chat_bookmarks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  title text not null,
  url text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chat_bookmarks_conv_idx on public.chat_bookmarks(conversation_id, created_at);

-- Who may add / edit / delete bookmarks in a conversation:
--   * 1:1 DM        — either participant
--   * announcement  — Bob only
--   * group         — admins always; members too when the admin has opened access
create or replace function public.can_edit_bookmarks(conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select is_announcement from public.chat_conversations where id = conv) then public.is_bob()
    when (select is_group from public.chat_conversations where id = conv) then
      public.is_chat_admin(conv)
      or (public.is_chat_member(conv)
          and coalesce((select bookmarks_members_can_edit from public.chat_conversations where id = conv), false))
    else public.is_chat_member(conv)
  end;
$$;
revoke all on function public.can_edit_bookmarks(uuid) from public;
grant execute on function public.can_edit_bookmarks(uuid) to authenticated;

alter table public.chat_bookmarks enable row level security;
drop policy if exists "chat bookmark read" on public.chat_bookmarks;
create policy "chat bookmark read" on public.chat_bookmarks
  for select using (
    public.is_chat_member(conversation_id)
    or (public.is_announcement_conv(conversation_id) and public.is_internal_staff())
  );
drop policy if exists "chat bookmark insert" on public.chat_bookmarks;
create policy "chat bookmark insert" on public.chat_bookmarks
  for insert with check (public.can_edit_bookmarks(conversation_id) and created_by = auth.uid());
drop policy if exists "chat bookmark update" on public.chat_bookmarks;
create policy "chat bookmark update" on public.chat_bookmarks
  for update using (public.can_edit_bookmarks(conversation_id))
  with check (public.can_edit_bookmarks(conversation_id));
drop policy if exists "chat bookmark delete" on public.chat_bookmarks;
create policy "chat bookmark delete" on public.chat_bookmarks
  for delete using (public.can_edit_bookmarks(conversation_id));
grant select, insert, update, delete on public.chat_bookmarks to authenticated;
