-- =========================================================
-- Afflix Core — Internal handlers: brand-group chat membership +
--               brand-scoped Tasks visibility
--
-- Follow-up to 20260717 (internal vs external Paid Collab Handlers):
--
--  1. CHAT — an INTERNAL handler now belongs to the auto-managed brand group
--     of every brand they're assigned (paid_collab_handler_brands), as a
--     MEMBER (Bob + Team Lead stay the admins). The roster keeps following
--     access: assigning / unassigning a brand, or flipping the handler
--     internal ↔ external, adds / soft-archives them like any other member.
--     External handlers are never added.
--
--  2. TASKS — visibility is re-scoped from "everything" to "like a Team
--     Lead": an internal handler sees THEIR assigned brands (base brands RLS
--     already does this — the 20260717 read-ALL-brands policy is dropped),
--     those brands' APC + Team Lead mappings, and those people's profiles
--     (plus Bob). handler_can_assign() is tightened to APCs who hold at
--     least one of the handler's brands.
-- =========================================================

-- ---------- 1. Helpers ----------
-- Is the CALLER an internal handler assigned to this brand?
create or replace function public.internal_handler_has_brand(b_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_handler()
     and exists (
       select 1 from public.paid_collab_handler_brands hb
       where hb.handler_id = auth.uid() and hb.brand_id = b_id
     );
$$;
grant execute on function public.internal_handler_has_brand(uuid) to authenticated;

-- May the calling internal handler see this profile? Bob, plus the APCs /
-- Team Leads of the handler's own brands.
create or replace function public.internal_handler_sees_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_handler() and (
    exists (select 1 from public.profiles where id = p_user and role = 'bob')
    or exists (
      select 1 from public.apc_brands ab
      join public.paid_collab_handler_brands hb
        on hb.brand_id = ab.brand_id and hb.handler_id = auth.uid()
      where ab.apc_id = p_user
    )
    or exists (
      select 1 from public.team_lead_brands tb
      join public.paid_collab_handler_brands hb
        on hb.brand_id = tb.brand_id and hb.handler_id = auth.uid()
      where tb.team_lead_id = p_user
    )
  );
$$;
grant execute on function public.internal_handler_sees_profile(uuid) to authenticated;

-- ---------- 2. Re-scope the 20260717 visibility policies ----------
-- Brands: back to the base "brands read scoped" (assigned brands only).
drop policy if exists "brands internal handler read" on public.brands;

-- apc_brands: only rows for the handler's own brands.
drop policy if exists "apc_brands internal handler read" on public.apc_brands;
create policy "apc_brands internal handler read" on public.apc_brands
  for select using (public.internal_handler_has_brand(brand_id));

-- team_lead_brands: NEW — see which Team Lead owns each of the handler's brands.
drop policy if exists "team_lead_brands internal handler read" on public.team_lead_brands;
create policy "team_lead_brands internal handler read" on public.team_lead_brands
  for select using (public.internal_handler_has_brand(brand_id));

-- profiles: Bob + the APCs / Team Leads of the handler's brands (was: all staff).
drop policy if exists "profiles internal handler read staff" on public.profiles;
create policy "profiles internal handler read staff" on public.profiles
  for select using (public.internal_handler_sees_profile(id));

-- Assignment tightened to APCs who hold one of the handler's brands.
create or replace function public.handler_can_assign(p_assignee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_handler()
     and exists (select 1 from public.profiles p where p.id = p_assignee and p.role = 'apc')
     and exists (
       select 1 from public.apc_brands ab
       join public.paid_collab_handler_brands hb
         on hb.brand_id = ab.brand_id and hb.handler_id = auth.uid()
       where ab.apc_id = p_assignee
     );
$$;

-- ---------- 3. Brand chat groups include internal handlers ----------
-- Reproduced from 20260716; the only change is the internal-handler MEMBER
-- rows in both roster CTEs.
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
  -- + assigned INTERNAL Paid Collab Handler(s) as members. bool_or() collapses
  -- a user appearing on several sides to admin.
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
      union all
      select hb.handler_id, false
        from public.paid_collab_handler_brands hb
        join public.profiles p on p.id = hb.handler_id
         and p.role = 'paid_collab_handler' and p.is_internal_handler
       where hb.brand_id = p_brand
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
    union
    select hb.handler_id from public.paid_collab_handler_brands hb
      join public.profiles p on p.id = hb.handler_id
       and p.role = 'paid_collab_handler' and p.is_internal_handler
     where hb.brand_id = p_brand
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

-- Handler ↔ brand assignment changes → roster sync. DEFERRED like the
-- apc_brands / team_lead_brands triggers, because Bob's edit modal uses the
-- same delete-all-then-reinsert pattern.
drop trigger if exists paid_collab_handler_brands_sync_chat on public.paid_collab_handler_brands;
create constraint trigger paid_collab_handler_brands_sync_chat
  after insert or delete on public.paid_collab_handler_brands
  deferrable initially deferred
  for each row execute function public.tg_assignment_sync_chat();

-- Flipping a handler internal ↔ external → re-sync every brand group they're
-- assigned to (join on next tick of each group's roster).
create or replace function public.tg_handler_internal_sync_chat()
returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  for b in select brand_id from public.paid_collab_handler_brands
            where handler_id = new.id loop
    perform public.sync_brand_chat_group(b.brand_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists profiles_handler_internal_sync_chat on public.profiles;
create trigger profiles_handler_internal_sync_chat
  after update of is_internal_handler on public.profiles
  for each row
  when (old.is_internal_handler is distinct from new.is_internal_handler)
  execute function public.tg_handler_internal_sync_chat();

-- ---------- 4. Backfill: re-sync groups of brands that have a handler ----------
do $$
declare b record;
begin
  for b in select distinct hb.brand_id
             from public.paid_collab_handler_brands hb
             join public.profiles p on p.id = hb.handler_id
              and p.role = 'paid_collab_handler' and p.is_internal_handler
  loop
    perform public.sync_brand_chat_group(b.brand_id);
  end loop;
end $$;
