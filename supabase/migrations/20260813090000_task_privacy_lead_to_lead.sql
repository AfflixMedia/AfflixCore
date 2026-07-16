-- =========================================================
-- Afflix Core — Task privacy + Team Lead → Team Lead assignment
--
-- 1. TASK PRIVACY: a task is visible ONLY to its assigner (created_by) and
--    its assignee. Bob loses his read-all oversight ("tasks bob all" is
--    replaced by creator/assignee-scoped policies) and a Team Lead loses the
--    manages_apc() read of tasks OTHER people (e.g. Bob) assigned to their
--    APCs. Every other role's task policies were already creator-scoped
--    (APC 20260719, internal handler 20260717, ads manager 20260726) and the
--    role-agnostic assignee read/update policies from 20260621 stay.
--    Recurrence generation + due reminders are SECURITY DEFINER RPCs, and
--    tasks_notify is a SECURITY DEFINER trigger — none are affected.
--
-- 2. TEAM LEAD → TEAM LEAD: a Team Lead may now assign a task to another
--    Team Lead (not themselves), alongside their own APCs. New helper
--    is_team_lead_user(uuid) mirrors is_bob_user(uuid); a profiles policy
--    lets Team Leads read each other's rows (name/avatar for the picker,
--    the right rail, and the "assigned by" line).
--
-- Apply with: supabase db push  (or paste into the SQL editor)
-- =========================================================

-- ---------- 1. Helper: is a GIVEN user a Team Lead? ----------
-- SECURITY DEFINER so task policies can check the assignee's role without
-- depending on the caller's profiles read access (same as is_bob_user).
create or replace function public.is_team_lead_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'team_lead');
$$;
grant execute on function public.is_team_lead_user(uuid) to authenticated;

-- ---------- 2. Team Leads read each other's profiles ----------
drop policy if exists "profiles team_lead read leads" on public.profiles;
create policy "profiles team_lead read leads" on public.profiles
  for select using (role = 'team_lead' and public.is_team_lead());

-- ---------- 3. Bob: creator/assignee-scoped (no more read-all) ----------
drop policy if exists "tasks bob all" on public.tasks;

drop policy if exists "tasks bob insert" on public.tasks;
create policy "tasks bob insert" on public.tasks
  for insert with check (public.is_bob() and created_by = auth.uid());

drop policy if exists "tasks bob read" on public.tasks;
create policy "tasks bob read" on public.tasks
  for select using (public.is_bob()
                    and (created_by = auth.uid() or assignee_id = auth.uid()));

drop policy if exists "tasks bob update" on public.tasks;
create policy "tasks bob update" on public.tasks
  for update using (public.is_bob()
                    and (created_by = auth.uid() or assignee_id = auth.uid()))
  with check (public.is_bob()
              and (created_by = auth.uid() or assignee_id = auth.uid()));

drop policy if exists "tasks bob delete" on public.tasks;
create policy "tasks bob delete" on public.tasks
  for delete using (public.is_bob()
                    and (created_by = auth.uid() or assignee_id = auth.uid()));

-- ---------- 4. Team Lead: creator-scoped + assign to APCs OR other leads ----
-- (The 20260621 policies keyed on manages_apc(assignee_id), which both leaked
-- Bob→APC tasks to the lead and blocked lead→lead assignment.)
drop policy if exists "tasks lead read" on public.tasks;
create policy "tasks lead read" on public.tasks
  for select using (public.is_team_lead() and created_by = auth.uid());

drop policy if exists "tasks lead insert" on public.tasks;
create policy "tasks lead insert" on public.tasks
  for insert with check (
    public.is_team_lead()
    and created_by = auth.uid()
    and (public.manages_apc(assignee_id)
         or (public.is_team_lead_user(assignee_id) and assignee_id <> auth.uid()))
  );

-- WITH CHECK keeps the assignee inside the allowed set on re-assignment.
drop policy if exists "tasks lead update" on public.tasks;
create policy "tasks lead update" on public.tasks
  for update using (public.is_team_lead() and created_by = auth.uid())
  with check (
    created_by = auth.uid()
    and (public.manages_apc(assignee_id)
         or (public.is_team_lead_user(assignee_id) and assignee_id <> auth.uid()))
  );

drop policy if exists "tasks lead delete" on public.tasks;
create policy "tasks lead delete" on public.tasks
  for delete using (public.is_team_lead() and created_by = auth.uid());
