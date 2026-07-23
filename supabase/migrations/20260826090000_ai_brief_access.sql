-- =========================================================
-- Afflix Core — AI Content Brief: per-handler access flag
--
-- Step 1 of the AI content-brief feature (the RAG knowledge base and the
-- generation edge function land in later migrations). This one only adds the
-- ACCESS GATE that the Super Boss controls:
--
--   profiles.ai_brief_enabled  — paid_collab_handler only, default FALSE.
--   Every existing handler therefore starts with NO access; the Super Boss
--   grants it per handler on the Paid Collab Handlers page.
--
-- Same flag-on-a-role pattern as `is_internal_handler` / `is_superbob` — no
-- new role string, so every existing role check keeps working untouched.
--
-- ‼️ SECURITY — why this migration also touches profiles_protect_privileges:
-- the base policy "profiles self update" (schema.sql) lets ANY user update
-- their own profiles row. Without a guard, a paid_collab_handler could simply
-- flip their own ai_brief_enabled to true and grant themselves access. The
-- BEFORE-UPDATE trigger from 20260719090000 is re-created below with a third
-- guarded column so only a Super Boss (or the service role / SQL editor,
-- where auth.uid() is null) can change it.
--
-- ADDITIVE — no existing data or policies are dropped.
-- Apply with: supabase db push  (or paste into the SQL editor)
--
-- NOTE on `supabase db push`: three older migration timestamps are duplicated
-- across two files each (20260706 / 20260809 / 20260810), so push may report
-- them as pending. Workaround documented in CLAUDE.local.md §10 — temporarily
-- move the alphabetically-later file of each pair out of supabase/migrations/.
-- =========================================================

-- ---------- 1. Flag ----------
alter table public.profiles
  add column if not exists ai_brief_enabled boolean not null default false;

comment on column public.profiles.ai_brief_enabled is
  'Paid Collab Handlers only: may use the AI Content Brief generator. Granted per handler by a Super Boss. Guarded by profiles_protect_privileges.';

-- ---------- 2. Privilege guard (re-created; base = 20260719090000) ----------
-- Unchanged behaviour for is_superbob / role. New: ai_brief_enabled may only
-- be changed by a Super Boss. Regular Bobs deliberately cannot grant it —
-- the user's requirement is that the Super Boss alone controls this.
create or replace function public.profiles_protect_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Service role / SQL editor / edge functions have no auth.uid(): always allowed.
  if auth.uid() is null then return new; end if;

  if new.is_superbob is distinct from old.is_superbob and not public.is_superbob() then
    raise exception 'Only a Super Bob can change Super Bob status';
  end if;

  -- AI Content Brief access is a Super Boss-only grant. Without this arm the
  -- permissive "profiles self update" policy would let a handler self-grant.
  if new.ai_brief_enabled is distinct from old.ai_brief_enabled and not public.is_superbob() then
    raise exception 'Only a Super Boss can change AI Content Brief access';
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

-- ---------- 3. Helper ----------
-- Caller may use the AI Content Brief generator. SECURITY DEFINER so the
-- upcoming knowledge-base tables and the generation edge function can gate on
-- it without depending on the caller's own profiles read access.
-- Super Boss always passes (he owns the feature and needs to test it).
create or replace function public.can_use_ai_brief()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (
        (role = 'paid_collab_handler' and ai_brief_enabled)
        or (role = 'bob' and is_superbob)
      )
  );
$$;
grant execute on function public.can_use_ai_brief() to authenticated;

-- ---------- 4. Reads ----------
-- Bob already reads every profiles row ("profiles bob read"), so the Paid
-- Collab Handlers page sees ai_brief_enabled with no new policy. A handler
-- reads their own row via "profiles self read" — that is how the front-end
-- knows whether to render the Content Brief tab. Nothing to add here.
