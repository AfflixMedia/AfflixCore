-- =========================================================
-- Afflix Core — Internal vs External Paid Collab Handlers
--
-- Bob now classifies each Paid Collab Handler as INTERNAL or EXTERNAL
-- (profiles.is_internal_handler, default false → every existing handler stays
-- external). The flag is set on the create form and editable from Bob's
-- Paid Collab Handlers page.
--
-- An INTERNAL handler is treated as internal staff:
--   * Chats — full access again (DMs, groups, announcement, mentions,
--     notifications). 20260627 removed ALL handlers from chat; this re-admits
--     only the internal ones by re-defining is_internal_staff() and swapping
--     the explicit role lists in the chat RPCs/trigger for is_chat_staff().
--   * Tasks — can assign tasks to ANY APC (like a Team Lead, but not scoped
--     to a team), remind, use folders/labels, and create recurring schedules.
--     Bob can also assign tasks TO a handler (assignee policies were already
--     role-agnostic; Bob's insert falls under "tasks bob all").
--   * Sees which brands belong to which APC (apc_brands + brands read).
--
-- EXTERNAL handlers keep today's behaviour exactly (no chat, no tasks).
--
-- ADDITIVE apart from re-created function bodies. Function bodies are
-- reproduced from their latest definitions (20260627 for the chat RPCs +
-- notify trigger, 20260709 for chat_list_contacts) — the only change is the
-- role check.
-- =========================================================

-- ---------- 1. Column ----------
alter table public.profiles
  add column if not exists is_internal_handler boolean not null default false;

-- ---------- 2. Helpers ----------
-- Is the CALLER an internal Paid Collab Handler?
create or replace function public.is_internal_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'paid_collab_handler'
      and is_internal_handler
  );
$$;
grant execute on function public.is_internal_handler() to authenticated;

-- Is a GIVEN user part of the internal-staff circle (bob / team_lead / apc /
-- internal handler)? Single source of truth for every chat role check.
create or replace function public.is_chat_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = p_user
      and (role in ('bob', 'team_lead', 'apc')
           or (role = 'paid_collab_handler' and is_internal_handler))
  );
$$;
grant execute on function public.is_chat_staff(uuid) to authenticated;

-- ---------- 3. is_internal_staff now includes internal handlers ----------
-- Cascades through every chat RLS policy, the announcement roster,
-- chat_mark_delivered, and the task_folders / task_labels read policies.
create or replace function public.is_internal_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_chat_staff(auth.uid());
$$;

-- ---------- 4. Chat RPCs / trigger: role lists → is_chat_staff ----------

-- chat_list_contacts (from 20260709, avatar_url version)
create or replace function public.chat_list_contacts()
returns table (id uuid, full_name text, email text, role text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.avatar_url
  from public.profiles p
  where public.is_chat_staff(p.id)
    and p.id <> auth.uid()
    and public.is_internal_staff();
$$;

-- chat_get_or_create_dm (from 20260627)
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
  if not public.is_chat_staff(other_user) then
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

-- chat_create_group (from 20260627)
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
    if m <> me and public.is_chat_staff(m) then
      insert into public.chat_participants (conversation_id, user_id) values (conv, m)
      on conflict do nothing;
    end if;
  end loop;
  return conv;
end;
$$;

-- chat_add_member (3-arg, from 20260627)
create or replace function public.chat_add_member(p_conv uuid, p_user uuid, p_show_history boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare hist timestamptz;
begin
  if not public.is_chat_admin(p_conv) then raise exception 'not a group admin'; end if;
  if not public.is_chat_staff(p_user) then
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

-- chat_on_new_message (from 20260627) — notification fan-out now reaches
-- internal handlers; external handlers (and any lingering participant rows of
-- theirs) are still skipped.
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

  -- Everyone else in the conversation gets a normal chat notification.
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

  return new;
end;
$$;

-- ---------- 5. Tasks: internal handler assigns to any APC ----------
-- May the calling internal handler target this assignee? (APCs only — a
-- handler can't assign to Bob, Team Leads, or other handlers.)
create or replace function public.handler_can_assign(p_assignee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_handler()
     and exists (select 1 from public.profiles where id = p_assignee and role = 'apc');
$$;
grant execute on function public.handler_can_assign(uuid) to authenticated;

-- (Assignee read/update policies from 20260621 are role-agnostic, so a handler
-- already sees + completes tasks Bob assigns to them.)
drop policy if exists "tasks handler read" on public.tasks;
create policy "tasks handler read" on public.tasks
  for select using (public.is_internal_handler() and created_by = auth.uid());

drop policy if exists "tasks handler insert" on public.tasks;
create policy "tasks handler insert" on public.tasks
  for insert with check (created_by = auth.uid() and public.handler_can_assign(assignee_id));

drop policy if exists "tasks handler update" on public.tasks;
create policy "tasks handler update" on public.tasks
  for update using (public.is_internal_handler() and created_by = auth.uid())
  with check (created_by = auth.uid() and public.handler_can_assign(assignee_id));

drop policy if exists "tasks handler delete" on public.tasks;
create policy "tasks handler delete" on public.tasks
  for delete using (public.is_internal_handler() and created_by = auth.uid());

-- task_reminders: the 20260708 insert policy already allows the task's creator
-- (t.created_by = auth.uid()) and "sender read" covers created_by — a handler
-- reminding on their own task needs no new policy. task_folders/task_labels
-- read via is_internal_staff() now includes internal handlers; write is
-- owner-scoped and role-agnostic.

-- task_recurrences: let internal handlers own recurring schedules too.
drop policy if exists "task_recurrences owner all" on public.task_recurrences;
create policy "task_recurrences owner all" on public.task_recurrences
  for all using (created_by = auth.uid())
  with check (created_by = auth.uid()
              and (public.is_bob() or public.is_team_lead() or public.is_internal_handler()));

-- ---------- 6. Visibility for the assignment UI ----------
-- Internal handler sees the staff directory (assignee picker, "assigned by"
-- names). Mirrors what chat_list_contacts already exposes to them.
drop policy if exists "profiles internal handler read staff" on public.profiles;
create policy "profiles internal handler read staff" on public.profiles
  for select using (role in ('bob', 'team_lead', 'apc') and public.is_internal_handler());

-- Internal staff see internal handler profiles (APC's "from X" on a
-- handler-assigned task, Team Lead oversight, chat member names).
drop policy if exists "profiles staff read internal handlers" on public.profiles;
create policy "profiles staff read internal handlers" on public.profiles
  for select using (role = 'paid_collab_handler' and is_internal_handler
                    and public.is_internal_staff());

-- Which brands sit under which APC — shown in the handler's assignee picker.
drop policy if exists "apc_brands internal handler read" on public.apc_brands;
create policy "apc_brands internal handler read" on public.apc_brands
  for select using (public.is_internal_handler());

-- Brand names for that mapping (handlers otherwise only read their own
-- paid-collab-assigned brands).
drop policy if exists "brands internal handler read" on public.brands;
create policy "brands internal handler read" on public.brands
  for select using (public.is_internal_handler());
