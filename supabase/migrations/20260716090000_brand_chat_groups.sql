-- =========================================================
-- Afflix Core — Brand chat groups + Resources ↔ Bookmarks sync
--
--  1. Every brand gets a dedicated group conversation in Chats, titled after
--     the brand (chat_conversations.brand_id links them, one group per brand).
--     Roster mirrors brand access: Bob(s) + the brand's Team Lead are ADMINS,
--     the assigned APC is a member. When brand access changes (any path:
--     set_apc_brands / set_brand_assignment / claim_apc / promote / demote /
--     APC deletion cascade), the group membership follows automatically —
--     losing access soft-archives the member (phase-4 left_at model), gaining
--     access adds / re-activates them with full history.
--  2. Brand renames rename the group. Existing brands are backfilled.
--  3. The brand's link resources (resources.scope = 'brand') are mirrored into
--     the group's Bookmarks and vice versa (chat_bookmarks.resource_id links a
--     bookmark 1:1 to a resource). Create/edit/delete on either side syncs the
--     other. Brand groups open bookmark editing to all members so the APC's
--     resource-write rights are matched in chat.
--
-- Membership sync uses DEFERRED constraint triggers on apc_brands /
-- team_lead_brands so the RPCs' "delete-all-then-reinsert" reconcile pattern
-- is evaluated once against the FINAL state at commit (no remove/re-add churn
-- in the membership log).
-- =========================================================

-- ---------- 1. Schema: link columns ----------
alter table public.chat_conversations
  add column if not exists brand_id uuid references public.brands(id) on delete set null;
create unique index if not exists chat_conversations_brand_uidx
  on public.chat_conversations(brand_id) where brand_id is not null;

alter table public.chat_bookmarks
  add column if not exists resource_id uuid references public.resources(id) on delete cascade;
create unique index if not exists chat_bookmarks_resource_uidx
  on public.chat_bookmarks(resource_id) where resource_id is not null;

-- =====================================================================
-- 2. Resources ↔ Bookmarks sync triggers
--    Loop guards: a row written BY the opposite side's trigger runs at
--    pg_trigger_depth() > 1 and is skipped; bookmark inserts that already
--    carry resource_id (made by the resource side / the seeder) are ignored.
-- =====================================================================

-- ---- resource → bookmark ----
create or replace function public.tg_resource_sync_bookmark()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- written by bookmark side
  if new.scope <> 'brand' or new.brand_id is null then return new; end if;

  select id into v_conv from public.chat_conversations where brand_id = new.brand_id;
  if v_conv is null then return new; end if;           -- no brand group (yet)

  if tg_op = 'UPDATE' and (new.name, new.url) is distinct from (old.name, old.url) then
    update public.chat_bookmarks
       set title = new.name, url = new.url, updated_at = now()
     where resource_id = new.id;
  end if;

  -- Insert (also self-heals a missing bookmark on any later update).
  insert into public.chat_bookmarks (conversation_id, title, url, created_by, resource_id)
  select v_conv, new.name, new.url, new.created_by, new.id
  where not exists (select 1 from public.chat_bookmarks b where b.resource_id = new.id);

  return new;
end;
$$;

drop trigger if exists resources_sync_bookmark on public.resources;
create trigger resources_sync_bookmark
  after insert or update on public.resources
  for each row execute function public.tg_resource_sync_bookmark();
-- (resource DELETE → bookmark delete is handled by the resource_id FK cascade)

-- ---- bookmark → resource ----
-- BEFORE INSERT: a hand-added bookmark in a brand group becomes a brand resource.
create or replace function public.tg_bookmark_sync_resource_ins()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_brand uuid; v_res uuid;
begin
  if new.resource_id is not null then return new; end if;   -- already linked
  select brand_id into v_brand from public.chat_conversations where id = new.conversation_id;
  if v_brand is null then return new; end if;               -- not a brand group

  insert into public.resources (name, url, scope, brand_id, created_by)
  values (coalesce(nullif(btrim(new.title), ''), new.url), new.url, 'brand', v_brand, new.created_by)
  returning id into v_res;
  new.resource_id := v_res;
  return new;
end;
$$;

drop trigger if exists chat_bookmarks_sync_resource_ins on public.chat_bookmarks;
create trigger chat_bookmarks_sync_resource_ins
  before insert on public.chat_bookmarks
  for each row execute function public.tg_bookmark_sync_resource_ins();

-- AFTER UPDATE: bookmark edits flow back to the linked resource.
create or replace function public.tg_bookmark_sync_resource_upd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;   -- written by resource side
  if new.resource_id is not null
     and (new.title, new.url) is distinct from (old.title, old.url) then
    update public.resources
       set name = new.title, url = new.url
     where id = new.resource_id
       and (name, url) is distinct from (new.title, new.url);
  end if;
  return new;
end;
$$;

drop trigger if exists chat_bookmarks_sync_resource_upd on public.chat_bookmarks;
create trigger chat_bookmarks_sync_resource_upd
  after update on public.chat_bookmarks
  for each row execute function public.tg_bookmark_sync_resource_upd();

-- AFTER DELETE: deleting a bookmark deletes the linked resource. When the
-- delete was CASCADED from the resource side the row is already gone → no-op.
create or replace function public.tg_bookmark_sync_resource_del()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.resource_id is not null then
    delete from public.resources where id = old.resource_id;
  end if;
  return old;
end;
$$;

drop trigger if exists chat_bookmarks_sync_resource_del on public.chat_bookmarks;
create trigger chat_bookmarks_sync_resource_del
  after delete on public.chat_bookmarks
  for each row execute function public.tg_bookmark_sync_resource_del();

-- =====================================================================
-- 3. sync_brand_chat_group(brand) — ensure the group exists, keep the title
--    equal to the brand name, reconcile the roster to current brand access,
--    and seed bookmarks from the brand's existing resources.
-- =====================================================================
create or replace function public.sync_brand_chat_group(p_brand uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_conv uuid;
  v_bob  uuid;
begin
  -- Lock the brand row so concurrent syncs of the same brand serialize.
  select name into v_name from public.brands where id = p_brand for update;
  if v_name is null then return; end if;   -- brand gone (delete cascade)

  select id into v_conv from public.chat_conversations where brand_id = p_brand;

  if v_conv is null then
    -- Bob owns brand groups; members can edit bookmarks (mirrors resources RLS).
    select id into v_bob from public.profiles where role = 'bob' order by created_at asc limit 1;
    insert into public.chat_conversations
      (is_group, title, brand_id, created_by, bookmarks_members_can_edit)
    values (true, v_name, p_brand, v_bob, true)
    returning id into v_conv;
  else
    update public.chat_conversations
       set title = v_name
     where id = v_conv and title is distinct from v_name;
  end if;

  -- Desired roster: Bob(s) + the brand's Team Lead(s) as admins, assigned APC(s)
  -- as members. bool_or() collapses a user appearing on both sides to admin.
  with desired as (
    select user_id, bool_or(is_admin) as is_admin from (
      select p.id as user_id, true as is_admin
        from public.profiles p
       where p.role = 'bob'
      union all
      select tlb.team_lead_id, true
        from public.team_lead_brands tlb
        join public.profiles p on p.id = tlb.team_lead_id and p.role = 'team_lead'
       where tlb.brand_id = p_brand
      union all
      select ab.apc_id, false
        from public.apc_brands ab
        join public.profiles p on p.id = ab.apc_id and p.role = 'apc'
       where ab.brand_id = p_brand
    ) u group by user_id
  ),
  reactivated as (
    update public.chat_participants cp
       set left_at      = null,
           is_admin     = d.is_admin,
           history_from = null,
           joined_at    = case when cp.left_at is not null then now() else cp.joined_at end,
           last_read_at = case when cp.left_at is not null then now() else cp.last_read_at end
      from desired d
     where cp.conversation_id = v_conv and cp.user_id = d.user_id
       and (cp.left_at is not null
            or cp.is_admin is distinct from d.is_admin
            or cp.history_from is not null)
    returning cp.user_id
  )
  insert into public.chat_participants (conversation_id, user_id, is_admin)
  select v_conv, d.user_id, d.is_admin
    from desired d
   where not exists (select 1 from public.chat_participants cp
                     where cp.conversation_id = v_conv and cp.user_id = d.user_id)
  on conflict do nothing;

  -- Soft-archive active members who no longer have brand access.
  with desired as (
    select p.id as user_id from public.profiles p where p.role = 'bob'
    union
    select tlb.team_lead_id from public.team_lead_brands tlb
      join public.profiles p on p.id = tlb.team_lead_id and p.role = 'team_lead'
     where tlb.brand_id = p_brand
    union
    select ab.apc_id from public.apc_brands ab
      join public.profiles p on p.id = ab.apc_id and p.role = 'apc'
     where ab.brand_id = p_brand
  )
  update public.chat_participants cp
     set left_at = now()
   where cp.conversation_id = v_conv
     and cp.left_at is null
     and not exists (select 1 from desired d where d.user_id = cp.user_id);

  -- Seed bookmarks for brand resources that don't have one yet (backfill +
  -- resources that were added before the group existed).
  insert into public.chat_bookmarks
    (conversation_id, title, url, created_by, resource_id, created_at, updated_at)
  select v_conv, r.name, r.url, r.created_by, r.id, r.created_at, r.updated_at
    from public.resources r
   where r.scope = 'brand' and r.brand_id = p_brand
     and not exists (select 1 from public.chat_bookmarks b where b.resource_id = r.id);
end;
$$;
revoke all on function public.sync_brand_chat_group(uuid) from public;

-- =====================================================================
-- 4. Triggers that keep the groups in sync
-- =====================================================================
-- Brand created / renamed → create group / rename it (+ roster sync).
create or replace function public.tg_brands_sync_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_brand_chat_group(new.id);
  return new;
end;
$$;

drop trigger if exists brands_sync_chat_insert on public.brands;
create trigger brands_sync_chat_insert
  after insert on public.brands
  for each row execute function public.tg_brands_sync_chat();

drop trigger if exists brands_sync_chat_rename on public.brands;
create trigger brands_sync_chat_rename
  after update of name on public.brands
  for each row execute function public.tg_brands_sync_chat();

-- Assignment changes → roster sync. DEFERRED so the "delete all + reinsert"
-- pattern used by set_apc_brands / set_brand_assignment reconciles once
-- against the final state at COMMIT instead of churning remove/re-add.
create or replace function public.tg_assignment_sync_chat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_brand_chat_group(old.brand_id);
  else
    perform public.sync_brand_chat_group(new.brand_id);
  end if;
  return null;
end;
$$;

drop trigger if exists apc_brands_sync_chat on public.apc_brands;
create constraint trigger apc_brands_sync_chat
  after insert or delete on public.apc_brands
  deferrable initially deferred
  for each row execute function public.tg_assignment_sync_chat();

drop trigger if exists team_lead_brands_sync_chat on public.team_lead_brands;
create constraint trigger team_lead_brands_sync_chat
  after insert or delete on public.team_lead_brands
  deferrable initially deferred
  for each row execute function public.tg_assignment_sync_chat();

-- =====================================================================
-- 5. Brand groups can't be left — membership mirrors brand access, and a
--    self-leave would silently desync until the next assignment change.
--    (Same precedent as the announcement channel.)
-- =====================================================================
create or replace function public.chat_leave_group(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_announcement_conv(p_conv) then raise exception 'cannot leave the announcement channel'; end if;
  if exists (select 1 from public.chat_conversations where id = p_conv and brand_id is not null) then
    raise exception 'cannot leave a brand group — membership follows brand access';
  end if;
  update public.chat_participants
    set left_at = now()
    where conversation_id = p_conv and user_id = auth.uid() and left_at is null;
end;
$$;

-- =====================================================================
-- 6. Backfill: create groups for every existing brand (roster + bookmarks).
-- =====================================================================
do $$
declare b record;
begin
  for b in select id from public.brands order by created_at loop
    perform public.sync_brand_chat_group(b.id);
  end loop;
end $$;
