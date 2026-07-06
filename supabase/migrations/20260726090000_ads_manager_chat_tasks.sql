-- =========================================================
-- Afflix Core — Ads Manager: Chats + Tasks, GMV-Max-only brands,
--                drop the "Limited Affiliates" scope
--
-- Follow-up to 20260725 (ads_manager role). Three changes:
--
-- 1. CHATS + TASKS "like an APC":
--    * is_chat_staff() gains role 'ads_manager' — cascades through
--      is_internal_staff(), every chat RLS policy, chat_list_contacts /
--      chat_get_or_create_dm / chat_create_group / chat_add_member, the
--      announcement roster, notification fan-out, chat_mark_delivered, and
--      the task_folders / task_labels read policies. (This does NOT widen
--      set_handler_creator_monthly: its gate is is_internal_staff() AND
--      user_has_brand_access(), and ads managers are still outside the
--      latter — the Performance GMV matrix stays read-only for them.)
--    * Tasks: Bob assigning TO an ads manager already works ("tasks bob all"
--      + the role-agnostic assignee read/update policies). New policies let
--      an ads manager assign UPWARD to any Bob and manage the tasks they
--      created — the APC pattern from 20260719, minus the Team Lead target
--      (ads managers have no team lead).
--    * Brand chat groups: sync_brand_chat_group() roster now also includes
--      the brand's Ads Manager(s) as MEMBERS, with a deferred constraint
--      trigger on ads_manager_brands (same delete-all-then-reinsert-safe
--      pattern as apc_brands / team_lead_brands / handler brands).
--    * profiles visibility: ads manager reads staff rows (assignee picker,
--      "from X" names); staff read ads-manager rows (chat names, task
--      creator names). Internal-handler rows were already covered by the
--      is_internal_staff()-based policy from 20260717.
--
-- 2. GMV-MAX-ONLY ASSIGNMENT: an ads manager may only hold brands whose
--    scope contains 'ads' (the "GMV Max" scope chip). Enforced in
--    set_ads_manager_brands (and mirrored in the create-ads-manager edge fn
--    + the Bob UI picker). Existing non-conforming rows are removed.
--
-- 3. SCOPE CLEANUP: the 'affiliate_limited' ("Limited Affiliates") scope is
--    retired — stripped from every brands.scope array; the UI option is
--    removed in Brands.tsx.
-- =========================================================

-- ---------- 1. is_chat_staff: + ads_manager ----------
create or replace function public.is_chat_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = p_user
      and (role in ('bob', 'team_lead', 'apc', 'ads_manager')
           or (role = 'paid_collab_handler' and is_internal_handler))
  );
$$;

-- ---------- 2. profiles visibility ----------

-- Ads manager sees the staff directory (Bobs for upward tasks, everyone's
-- names in chat). Mirrors "profiles internal handler read staff".
drop policy if exists "profiles ads_manager read staff" on public.profiles;
create policy "profiles ads_manager read staff" on public.profiles
  for select using (role in ('bob', 'team_lead', 'apc') and public.is_ads_manager());

-- Staff (incl. internal handlers, and ads managers themselves) see
-- ads-manager rows — task "from X" names, chat member names, Bob's pickers.
drop policy if exists "profiles staff read ads managers" on public.profiles;
create policy "profiles staff read ads managers" on public.profiles
  for select using (role = 'ads_manager' and public.is_internal_staff());

-- ---------- 3. Tasks: ads manager assigns upward to Bobs ----------
drop policy if exists "tasks ads_manager insert" on public.tasks;
create policy "tasks ads_manager insert" on public.tasks
  for insert with check (
    public.is_ads_manager()
    and created_by = auth.uid()
    and public.is_bob_user(assignee_id)
  );

drop policy if exists "tasks ads_manager creator read" on public.tasks;
create policy "tasks ads_manager creator read" on public.tasks
  for select using (public.is_ads_manager() and created_by = auth.uid());

drop policy if exists "tasks ads_manager creator update" on public.tasks;
create policy "tasks ads_manager creator update" on public.tasks
  for update using (public.is_ads_manager() and created_by = auth.uid())
  with check (created_by = auth.uid() and public.is_bob_user(assignee_id));

drop policy if exists "tasks ads_manager creator delete" on public.tasks;
create policy "tasks ads_manager creator delete" on public.tasks
  for delete using (public.is_ads_manager() and created_by = auth.uid());

-- (task_reminders needs no change: assignee read/ack policies are
-- assignee_id-based, so Bob's blocking reminders reach ads managers; ads
-- managers don't send reminders — like APCs.)

-- ---------- 4. Brand chat groups include Ads Managers ----------
-- Reproduced from 20260718; the only change is the ads_manager MEMBER rows
-- in both roster CTEs.
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
  -- + assigned INTERNAL Paid Collab Handler(s) + assigned Ads Manager(s) as
  -- members. bool_or() collapses a user appearing on several sides to admin.
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
      union all
      select amb.ads_manager_id, false
        from public.ads_manager_brands amb
        join public.profiles p on p.id = amb.ads_manager_id and p.role = 'ads_manager'
       where amb.brand_id = p_brand
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
    union
    select amb.ads_manager_id from public.ads_manager_brands amb
      join public.profiles p on p.id = amb.ads_manager_id and p.role = 'ads_manager'
     where amb.brand_id = p_brand
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

-- Ads-manager ↔ brand assignment changes → roster sync. DEFERRED like the
-- other assignment triggers (set_ads_manager_brands uses delete-then-insert).
drop trigger if exists ads_manager_brands_sync_chat on public.ads_manager_brands;
create constraint trigger ads_manager_brands_sync_chat
  after insert or delete on public.ads_manager_brands
  deferrable initially deferred
  for each row execute function public.tg_assignment_sync_chat();

-- ---------- 5. GMV-Max-only assignment ----------

-- Drop any existing assignment on a brand without the 'ads' (GMV Max) scope,
-- then re-sync those brands' chat groups. (No-op on a fresh role.)
do $$
declare b record;
begin
  for b in
    with del as (
      delete from public.ads_manager_brands amb
       using public.brands br
       where br.id = amb.brand_id and not ('ads' = any(br.scope))
      returning amb.brand_id
    )
    select distinct brand_id from del
  loop
    perform public.sync_brand_chat_group(b.brand_id);
  end loop;
end $$;

-- Re-create the RPC with the scope guard.
create or replace function public.set_ads_manager_brands(p_manager uuid, p_brand_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := coalesce(p_brand_ids, '{}'::uuid[]);
  v_added uuid[];
  v_names text;
  v_bad text;
begin
  if not public.is_bob() then raise exception 'Only Bob can set an Ads Manager''s brands'; end if;
  if (select role from public.profiles where id = p_manager) <> 'ads_manager' then
    raise exception 'Target is not an Ads Manager';
  end if;

  -- Every brand must carry the 'ads' (GMV Max) scope.
  select string_agg(b.name, ', ' order by b.name) into v_bad
  from public.brands b
  where b.id = any(v_ids) and not ('ads' = any(b.scope));
  if v_bad is not null then
    raise exception 'Only brands with the GMV Max scope can be assigned to an Ads Manager (not: %)', v_bad;
  end if;

  -- Brands newly added (for the notification), computed before the rewrite.
  select array_agg(b) into v_added
  from unnest(v_ids) b
  where not exists (select 1 from public.ads_manager_brands where ads_manager_id = p_manager and brand_id = b);

  delete from public.ads_manager_brands where ads_manager_id = p_manager;
  if array_length(v_ids, 1) > 0 then
    insert into public.ads_manager_brands (ads_manager_id, brand_id) select p_manager, unnest(v_ids);
  end if;

  if v_added is not null and array_length(v_added, 1) > 0 then
    select string_agg(name, ', ' order by name) into v_names from public.brands where id = any(v_added);
    insert into public.notifications (user_id, type, title, body, link, payload)
    values (p_manager, 'brand_assignment',
            'New brand' || case when array_length(v_added,1) > 1 then 's' else '' end || ' assigned to you',
            coalesce(v_names, 'A brand'),
            '/brands',
            jsonb_build_object('brand_ids', to_jsonb(v_added), 'kind', 'brand_assigned'));
  end if;
end;
$$;
revoke all on function public.set_ads_manager_brands(uuid, uuid[]) from public;
grant execute on function public.set_ads_manager_brands(uuid, uuid[]) to authenticated;

-- ---------- 6. Retire the 'affiliate_limited' scope ----------
update public.brands
   set scope = array_remove(scope, 'affiliate_limited')
 where 'affiliate_limited' = any(scope);
