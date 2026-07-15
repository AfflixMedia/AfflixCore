-- =========================================================
-- Afflix Core — Bob changes a user's role (APC → Ads Manager / Paid Collab
-- Handler / Paid Collab Client / Team Lead, and the reverse directions)
--
-- One Bob-only SECURITY DEFINER RPC:
--
--   change_user_role(p_user, p_new_role, p_internal default false)
--
-- Follows the promote/demote philosophy — DATA-SAFE: everything keyed by the
-- user's id (reports, comments, chat messages + history, notes, tasks they
-- created or were assigned, notifications, task folders/labels) is deliberately
-- untouched. Only role / flags / brand-assignment BOOKKEEPING changes:
--
--   * leaving APC          → apc_brands rows deleted (frees one-brand→one-APC;
--                            the deferred apc_brands_sync_chat trigger soft-
--                            archives them from those brand chat groups at commit)
--   * leaving Team Lead    → their APCs detach to no-team (keep their brands),
--                            team_lead_brands deleted (chat groups re-sync)
--   * leaving Handler      → paid_collab_handler_brands deleted (chat re-sync),
--                            is_internal_handler cleared
--   * leaving Client       → paid_collab_client_brands deleted
--   * leaving Ads Manager  → nothing manual: profiles_reconcile_ads (statement
--                            trigger on update of role) rebuilds the derived
--                            ads_manager_brands set, and its deferred chat-sync
--                            trigger fixes the brand-group rosters
--
--   * becoming Team Lead from APC → delegates to promote_apc_to_team_lead
--                            (brands carried over); other sources get the
--                            lead flags with an empty brand set
--   * becoming APC from Team Lead → delegates to demote_team_lead_to_apc
--                            (non-delegated brands carried back)
--   * becoming Ads Manager → profiles_reconcile_ads auto-assigns EVERY
--                            GMV-Max ('ads' scope) brand + chat groups
--   * becoming Handler     → p_internal decides internal/external; Bob assigns
--                            brands afterwards from the Paid Collab Handlers page
--   * becoming Client      → Bob assigns brands from the Paid Collab Clients page
--
-- Guard rails: caller must be Bob; cannot change own role; Bob/Super Bob
-- accounts are excluded (managed via the /bobs page + edge functions). The
-- profiles_protect_privileges trigger still runs and passes (caller is a Bob).
-- 'pending' is a valid SOURCE role, so Bob can activate fresh sign-ups too.
--
-- 100% ADDITIVE: new function only. Apply with: supabase db push
-- =========================================================

create or replace function public.change_user_role(
  p_user uuid,
  p_new_role text,
  p_internal boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_superbob boolean;
begin
  if not public.is_bob() then
    raise exception 'Only Bob can change roles';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  select role, coalesce(is_superbob, false) into v_old, v_superbob
    from public.profiles where id = p_user;
  if v_old is null then raise exception 'User not found'; end if;
  if v_old = 'bob' or v_superbob then
    raise exception 'Bob accounts are managed from the Bobs page';
  end if;

  if p_new_role not in ('apc','team_lead','ads_manager','paid_collab_handler','paid_collab_client') then
    raise exception 'Unsupported role: %', p_new_role;
  end if;

  -- Same role: the only meaningful change is the handler internal/external flag.
  if v_old = p_new_role then
    if p_new_role = 'paid_collab_handler' then
      update public.profiles
         set is_internal_handler = coalesce(p_internal, false)
       where id = p_user;
    end if;
    return;
  end if;

  -- Data-safe specialised paths keep their brand carry-over semantics.
  if v_old = 'apc' and p_new_role = 'team_lead' then
    perform public.promote_apc_to_team_lead(p_user);
    return;
  end if;
  if v_old = 'team_lead' and p_new_role = 'apc' then
    perform public.demote_team_lead_to_apc(p_user);
    return;
  end if;

  -- ---- 1. Clean up the OLD role's assignment bookkeeping ----
  if v_old = 'apc' then
    delete from public.apc_brands where apc_id = p_user;
  elsif v_old = 'team_lead' then
    update public.profiles set team_lead_id = null
      where role = 'apc' and team_lead_id = p_user;
    delete from public.team_lead_brands where team_lead_id = p_user;
  elsif v_old = 'paid_collab_handler' then
    delete from public.paid_collab_handler_brands where handler_id = p_user;
  elsif v_old = 'paid_collab_client' then
    delete from public.paid_collab_client_brands where client_id = p_user;
  end if;
  -- v_old in ('ads_manager','pending'): nothing manual — see reconcile note above.

  -- ---- 2. Flip the role ----
  update public.profiles
     set role = p_new_role,
         team_lead_id = null,
         is_internal_handler = (p_new_role = 'paid_collab_handler' and coalesce(p_internal, false)),
         can_edit_brands    = case when p_new_role = 'team_lead' then true else can_edit_brands end,
         can_manage_gmv_max = case when p_new_role = 'team_lead' then true else can_manage_gmv_max end
   where id = p_user;

  -- ---- 3. Tell the person ----
  insert into public.notifications (user_id, type, title, body, link)
  values (
    p_user, 'role_change', 'Your account role was changed',
    case p_new_role
      when 'apc'                 then 'You are now an APC (account manager).'
      when 'team_lead'           then 'You are now a Team Lead.'
      when 'ads_manager'         then 'You are now an Ads Manager.'
      when 'paid_collab_handler' then 'You are now a Paid Collab Handler.'
      when 'paid_collab_client'  then 'You are now a Paid Collab Client.'
    end,
    '/'
  );
end;
$$;

revoke all on function public.change_user_role(uuid, text, boolean) from public;
grant execute on function public.change_user_role(uuid, text, boolean) to authenticated;
