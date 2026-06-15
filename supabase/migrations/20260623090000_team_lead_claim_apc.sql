-- =========================================================
-- Afflix Core — Team Lead can claim unassigned APCs
--
-- A Team Lead can now SEE APCs that aren't on any team (team_lead_id is null) and
-- add them to their own team. They still cannot see or take APCs that belong to a
-- different team — only Bob can move those (set_team_lead_apcs).
--
-- ADDITIVE: one new SELECT policy + one SECURITY DEFINER RPC.
-- =========================================================

-- Team Lead may read unassigned APCs (so the UI can offer "add to my team").
drop policy if exists "profiles team_lead read unassigned apcs" on public.profiles;
create policy "profiles team_lead read unassigned apcs" on public.profiles
  for select using (role = 'apc' and team_lead_id is null and public.is_team_lead());

-- Claim an unassigned APC into the calling Team Lead's team (+ notify the APC).
-- SECURITY DEFINER because the row's team_lead_id is currently null, which the
-- "profiles team_lead update apcs" policy (team_lead_id = auth.uid()) would block.
create or replace function public.claim_apc(p_apc uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_lead_name text;
begin
  if not public.is_team_lead() then raise exception 'Only a Team Lead can claim an APC'; end if;
  if not exists (select 1 from public.profiles where id = p_apc and role = 'apc' and team_lead_id is null) then
    raise exception 'That APC is not available (already on a team, or not an APC)';
  end if;

  update public.profiles set team_lead_id = auth.uid()
    where id = p_apc and role = 'apc' and team_lead_id is null;

  select coalesce(nullif(full_name,''), email) into v_lead_name from public.profiles where id = auth.uid();
  insert into public.notifications (user_id, type, title, body, link, payload)
  values (p_apc, 'team_assignment', 'You''ve been added to a team',
          'You now report to ' || coalesce(v_lead_name, 'a Team Lead') || '.',
          '/brands', jsonb_build_object('team_lead_id', auth.uid(), 'kind', 'apc_assigned'));
end;
$$;
revoke all on function public.claim_apc(uuid) from public;
grant execute on function public.claim_apc(uuid) to authenticated;
