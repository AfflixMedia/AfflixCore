-- =========================================================
-- Afflix Core — Super Bob + upward task assignment
--
-- Super Bob is NOT a new role string: it is a flag (`profiles.is_superbob`)
-- on a role='bob' account, exactly like `is_internal_handler` on handlers.
-- Every is_bob() / role='bob' check in RLS, chat rosters, edge functions and
-- the front-end therefore keeps working for a Super Bob with zero changes —
-- the flag only gates the EXTRA powers:
--   * manage Bob accounts (create / delete / reset password via the new
--     create-bob / delete-bob / reset-bob-password edge functions + /bobs page)
--   * a Super Bob row is protected: only a Super Bob (or service role) can
--     change anyone's is_superbob flag or demote a Super Bob's role.
--
-- Also in this migration:
--   * Bob ↔ Bob tasks: already allowed by the "tasks bob all" policy — the
--     front-end just gains a "Bobs" group in the assignee picker/rail.
--   * APC → upward tasks: an APC may now create tasks for their own Team Lead
--     or for any Bob (incl. Super Bob), and read/update/delete tasks they
--     created. New policies below.
--   * Internal staff can read Bob profile rows (APCs/Team Leads need the name
--     + avatar of Bobs to pick them as assignees). Bob already reads all.
--   * Privilege guard trigger: closes the long-standing hole where
--     "profiles self update" let any user rewrite their own `role`.
--
-- ADDITIVE — no existing data or policies are dropped.
-- Apply with: supabase db push  (or paste into the SQL editor)
-- =========================================================

-- ---------- 1. Flag ----------
alter table public.profiles
  add column if not exists is_superbob boolean not null default false;

-- ---------- 2. Helpers ----------
-- Caller is a Super Bob (role bob + flag).
create or replace function public.is_superbob()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'bob' and is_superbob
  );
$$;
grant execute on function public.is_superbob() to authenticated;

-- Caller is an APC (mirrors is_bob()/is_team_lead()).
create or replace function public.is_apc()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'apc');
$$;
grant execute on function public.is_apc() to authenticated;

-- Is a GIVEN user a Bob? (SECURITY DEFINER so task policies can check the
-- assignee's role without depending on the caller's profiles read access.)
create or replace function public.is_bob_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and role = 'bob');
$$;
grant execute on function public.is_bob_user(uuid) to authenticated;

-- ---------- 3. Privilege guard ----------
-- Blocks privilege escalation through the permissive profile UPDATE policies
-- ("profiles self update" lets anyone edit their own row; "profiles bob update"
-- lets any Bob edit any row):
--   * is_superbob may only be changed by a Super Bob (or service role / SQL).
--   * role may only be changed by a Bob (promote/demote RPCs run as the calling
--     Bob) — and a Super Bob's role only by a Super Bob.
create or replace function public.profiles_protect_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role / SQL editor / edge functions have no auth.uid(): always allowed.
  if auth.uid() is null then return new; end if;

  if new.is_superbob is distinct from old.is_superbob and not public.is_superbob() then
    raise exception 'Only a Super Bob can change Super Bob status';
  end if;

  if new.role is distinct from old.role then
    if not public.is_bob() then
      raise exception 'Not allowed to change roles';
    end if;
    if old.is_superbob and not public.is_superbob() then
      raise exception 'Only a Super Bob can change a Super Bob''s role';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.profiles_protect_privileges();

-- ---------- 4. Staff can read Bob profiles ----------
-- Bobs already read everyone (so one Bob sees the other Bobs). APCs / Team
-- Leads / internal handlers now read Bob rows too — needed for the Tasks
-- assignee picker ("assign up") and the "assigned by" name on Bob-created tasks.
drop policy if exists "profiles staff read bobs" on public.profiles;
create policy "profiles staff read bobs" on public.profiles
  for select using (role = 'bob' and public.is_internal_staff());

-- ---------- 5. Tasks: APC assigns upward ----------
-- Bob → any Bob (incl. Super Bob) was already covered by "tasks bob all".
-- An APC may create tasks ONLY for their own Team Lead or a Bob, and manage
-- (read / edit / delete) the tasks they created. The existing tasks_notify
-- trigger notifies the assignee on insert and the creator on completion.
drop policy if exists "tasks apc insert" on public.tasks;
create policy "tasks apc insert" on public.tasks
  for insert with check (
    public.is_apc()
    and created_by = auth.uid()
    and (assignee_id = public.my_team_lead() or public.is_bob_user(assignee_id))
  );

drop policy if exists "tasks apc creator read" on public.tasks;
create policy "tasks apc creator read" on public.tasks
  for select using (public.is_apc() and created_by = auth.uid());

-- WITH CHECK keeps the assignee inside the allowed set on re-assignment.
drop policy if exists "tasks apc creator update" on public.tasks;
create policy "tasks apc creator update" on public.tasks
  for update using (public.is_apc() and created_by = auth.uid())
  with check (
    created_by = auth.uid()
    and (assignee_id = public.my_team_lead() or public.is_bob_user(assignee_id))
  );

drop policy if exists "tasks apc creator delete" on public.tasks;
create policy "tasks apc creator delete" on public.tasks
  for delete using (public.is_apc() and created_by = auth.uid());

-- ---------- 6. Promote the owner account ----------
-- bob@afflixmedia.com becomes the Super Bob (no-op if the account is missing;
-- flag any additional Super Bobs manually in SQL the same way).
update public.profiles
   set role = 'bob', is_superbob = true
 where lower(email) = 'bob@afflixmedia.com';
