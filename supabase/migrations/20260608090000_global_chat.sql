-- =========================================================
-- Afflix Core — Global Chat (internal team messaging)
--
-- Internal staff only: bob (admin), apc, paid_collab_handler.
-- Clients (paid_collab_client) are excluded everywhere by RLS.
--
-- Adds NEW tables/functions only. Existing tables are NOT modified.
-- Server assigns message timestamps (created_at default now()) so
-- concurrent senders never overlap or reorder each other's messages.
-- =========================================================

-- ---------- Helper: is the current user internal staff? ----------
create or replace function public.is_internal_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('bob', 'apc', 'paid_collab_handler')
  );
$$;

-- ---------- Tables ----------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text,                              -- group name; null for 1:1 DMs
  -- Deterministic key for a 1:1 DM: "<lesser-uuid>:<greater-uuid>". UNIQUE so
  -- two people starting a chat at the same instant can't create duplicate DMs.
  dm_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.chat_participants (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_participants_user_idx on public.chat_participants(user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  forwarded_from_id uuid references public.chat_messages(id) on delete set null,
  is_forwarded boolean not null default false,
  created_at timestamptz not null default now(),  -- SERVER time; never trust client clocks
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists chat_messages_conv_idx on public.chat_messages(conversation_id, created_at);
create index if not exists chat_messages_reply_idx on public.chat_messages(reply_to_id);

-- ---------- Membership helper (SECURITY DEFINER avoids RLS recursion) ----------
create or replace function public.is_chat_member(conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chat_participants
    where conversation_id = conv and user_id = auth.uid()
  );
$$;

-- ---------- Row Level Security ----------
alter table public.chat_conversations enable row level security;
alter table public.chat_participants  enable row level security;
alter table public.chat_messages      enable row level security;

-- conversations: members read; internal staff create their own
drop policy if exists "chat conv read" on public.chat_conversations;
create policy "chat conv read" on public.chat_conversations
  for select using (public.is_chat_member(id));

drop policy if exists "chat conv insert" on public.chat_conversations;
create policy "chat conv insert" on public.chat_conversations
  for insert with check (public.is_internal_staff() and created_by = auth.uid());

-- participants: members read the roster; a user updates only their own row
-- (last_read_at). DM participant inserts happen via SECURITY DEFINER RPC.
drop policy if exists "chat part read" on public.chat_participants;
create policy "chat part read" on public.chat_participants
  for select using (public.is_chat_member(conversation_id));

drop policy if exists "chat part self update" on public.chat_participants;
create policy "chat part self update" on public.chat_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "chat part add" on public.chat_participants;
create policy "chat part add" on public.chat_participants
  for insert with check (public.is_internal_staff() and public.is_chat_member(conversation_id));

-- messages: members read; an internal sender inserts their own; sender edits own
drop policy if exists "chat msg read" on public.chat_messages;
create policy "chat msg read" on public.chat_messages
  for select using (public.is_chat_member(conversation_id));

drop policy if exists "chat msg insert" on public.chat_messages;
create policy "chat msg insert" on public.chat_messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_internal_staff()
    and public.is_chat_member(conversation_id)
  );

drop policy if exists "chat msg self update" on public.chat_messages;
create policy "chat msg self update" on public.chat_messages
  for update using (sender_id = auth.uid()) with check (sender_id = auth.uid());

grant select, insert, update, delete on public.chat_conversations to authenticated;
grant select, insert, update, delete on public.chat_participants  to authenticated;
grant select, insert, update, delete on public.chat_messages      to authenticated;

-- ---------- RPC: internal-staff directory (profiles RLS stays untouched) ----------
create or replace function public.chat_list_contacts()
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role
  from public.profiles p
  where p.role in ('bob', 'apc', 'paid_collab_handler')
    and p.id <> auth.uid()
    and public.is_internal_staff();   -- empty result unless caller is staff
$$;
revoke all on function public.chat_list_contacts() from public;
grant execute on function public.chat_list_contacts() to authenticated;

-- ---------- RPC: get or create the 1:1 DM with another internal user ----------
create or replace function public.chat_get_or_create_dm(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    where id = other_user and role in ('bob', 'apc', 'paid_collab_handler')
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
revoke all on function public.chat_get_or_create_dm(uuid) from public;
grant execute on function public.chat_get_or_create_dm(uuid) to authenticated;

-- ---------- RPC: per-conversation last message + unread count (one round trip) ----------
create or replace function public.chat_overview()
returns table (
  conversation_id uuid,
  last_body text,
  last_sender_id uuid,
  last_at timestamptz,
  unread bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select conversation_id, last_read_at
    from public.chat_participants
    where user_id = auth.uid()
  ),
  last_msg as (
    select distinct on (m.conversation_id)
      m.conversation_id, m.body, m.sender_id, m.created_at
    from public.chat_messages m
    join mine on mine.conversation_id = m.conversation_id
    where m.deleted_at is null
    order by m.conversation_id, m.created_at desc
  ),
  unread as (
    select m.conversation_id, count(*)::bigint as cnt
    from public.chat_messages m
    join mine on mine.conversation_id = m.conversation_id
    where m.created_at > mine.last_read_at
      and m.sender_id <> auth.uid()
      and m.deleted_at is null
    group by m.conversation_id
  )
  select mine.conversation_id,
         last_msg.body, last_msg.sender_id, last_msg.created_at,
         coalesce(unread.cnt, 0)
  from mine
  left join last_msg on last_msg.conversation_id = mine.conversation_id
  left join unread   on unread.conversation_id  = mine.conversation_id;
$$;
revoke all on function public.chat_overview() from public;
grant execute on function public.chat_overview() to authenticated;

-- ---------- Trigger: on new message, bump conversation + notify recipients ----------
create or replace function public.chat_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_name text;
  preview text;
begin
  update public.chat_conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;

  select coalesce(nullif(full_name, ''), email) into sender_name
    from public.profiles where id = new.sender_id;

  preview := left(coalesce(new.body, ''), 140);

  -- Reuse the existing notifications system (in-app bell + realtime + OS push).
  insert into public.notifications (user_id, type, title, body, link, payload)
  select p.user_id, 'chat',
         coalesce(sender_name, 'New message'),
         preview,
         '/chats?c=' || new.conversation_id::text,
         jsonb_build_object(
           'conversation_id', new.conversation_id,
           'message_id', new.id,
           'sender_id', new.sender_id
         )
  from public.chat_participants p
  where p.conversation_id = new.conversation_id
    and p.user_id <> new.sender_id;

  return new;
end;
$$;

drop trigger if exists chat_messages_after_insert on public.chat_messages;
create trigger chat_messages_after_insert
  after insert on public.chat_messages
  for each row execute function public.chat_on_new_message();

-- ---------- Realtime (idempotent) ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_participants') then
    alter publication supabase_realtime add table public.chat_participants;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_conversations') then
    alter publication supabase_realtime add table public.chat_conversations;
  end if;
end $$;
