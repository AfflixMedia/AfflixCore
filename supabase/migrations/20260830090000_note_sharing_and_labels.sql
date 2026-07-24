-- =========================================================
-- Afflix Core — cross-role note sharing, role-based colours & saved labels
--
-- Keep-style notes (handler_notes) become a real internal-staff sharing
-- surface. Previously the only sharing was the boolean `shared_with_ads`
-- (Super Boss → Ads Managers, read-only). Now ANY internal-staff member
-- (bob / team_lead / apc / ads_manager, + Super Boss) can share a note with
-- ROLE GROUPS, and Super Boss additionally with EVERYONE / a SPECIFIC TEAM
-- (a Team Lead + the APCs under them). Recipients get READ-ONLY access; the
-- owner still edits/deletes. Card colours are now derived from the owner's
-- role in the front-end (the manual colour picker is gone — the `color`
-- column is kept but no longer used).
--
-- Also: `note_labels` — a per-owner label catalogue so labels created once
-- can be re-applied to other notes (notes still store label NAMES in
-- handler_notes.labels text[]; the catalogue is a reusable suggestion list).
--
-- ADDITIVE — existing policies (`owner all`, `bob read`, `superbob ads all`,
-- `ads read shared`) and the `shared_with_ads` column are left untouched.
-- Apply with: supabase db push  (or paste into the SQL editor).
-- =========================================================

-- ---------- 1. Share rows ----------
create table if not exists public.handler_note_shares (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.handler_notes(id) on delete cascade,
  target_kind text not null check (target_kind in ('all', 'role', 'team')),
  target_role text check (target_role in ('super_boss', 'bob', 'team_lead', 'apc', 'ads_manager')),
  target_team uuid references public.profiles(id) on delete cascade,  -- the Team Lead (kind='team')
  created_at  timestamptz not null default now()
);

create unique index if not exists handler_note_shares_uniq
  on public.handler_note_shares (
    note_id,
    target_kind,
    coalesce(target_role, ''),
    coalesce(target_team, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists handler_note_shares_note_idx
  on public.handler_note_shares(note_id);

alter table public.handler_note_shares enable row level security;

-- Owner of the parent note manages its shares. Sharing to a ROLE group is open
-- to any owner; sharing to EVERYONE or a whole TEAM is Super Boss only.
drop policy if exists "note_shares owner write" on public.handler_note_shares;
create policy "note_shares owner write" on public.handler_note_shares
  for all
  using (
    exists (
      select 1 from public.handler_notes n
      where n.id = handler_note_shares.note_id and n.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.handler_notes n
      where n.id = handler_note_shares.note_id and n.owner_id = auth.uid()
    )
    and (
      target_kind = 'role'
      or (target_kind in ('all', 'team') and public.is_superbob())
    )
  );

-- Owner reads their note's shares (to render current toggle state in the editor).
-- Recipients never read this table directly — visibility is resolved by the
-- SECURITY DEFINER helper below.
drop policy if exists "note_shares owner read" on public.handler_note_shares;
create policy "note_shares owner read" on public.handler_note_shares
  for select using (
    exists (
      select 1 from public.handler_notes n
      where n.id = handler_note_shares.note_id and n.owner_id = auth.uid()
    )
  );

-- ---------- 2. Recipient-visibility helper ----------
-- True when a share row on p_note grants the CURRENT caller access. SECURITY
-- DEFINER so the EXISTS bypasses handler_note_shares' owner-only read RLS.
create or replace function public.note_shared_with_caller(p_note uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_super boolean;
  v_lead  uuid;
begin
  select role, coalesce(is_superbob, false), team_lead_id
    into v_role, v_super, v_lead
  from public.profiles where id = auth.uid();
  if v_role is null then return false; end if;

  return exists (
    select 1 from public.handler_note_shares s
    where s.note_id = p_note
      and (
        (s.target_kind = 'all'
          and v_role in ('bob', 'team_lead', 'apc', 'ads_manager'))
        or (s.target_kind = 'role' and (
              (s.target_role = 'super_boss'  and v_super)
           or (s.target_role = 'bob'         and v_role = 'bob')
           or (s.target_role = 'team_lead'   and v_role = 'team_lead')
           or (s.target_role = 'apc'         and v_role = 'apc')
           or (s.target_role = 'ads_manager' and v_role = 'ads_manager')
        ))
        or (s.target_kind = 'team' and (
              (v_role = 'team_lead' and auth.uid() = s.target_team)
           or (v_role = 'apc' and v_lead = s.target_team)
        ))
      )
  );
end $$;
grant execute on function public.note_shared_with_caller(uuid) to authenticated;

-- ---------- 3. handler_notes: recipient read ----------
-- Additive SELECT policy — a note is also readable by anyone a share grants.
drop policy if exists "handler_notes shared read" on public.handler_notes;
create policy "handler_notes shared read" on public.handler_notes
  for select using (public.note_shared_with_caller(id));

-- ---------- 4. Board read RPC ----------
-- Returns every note the caller OWNS or is SHARED, with the owner's role/name
-- folded in (for role-based colouring + the "shared by" chip). Also scopes Bob
-- to own+shared instead of his read-all flood.
create or replace function public.list_visible_notes()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(hn)
       || jsonb_build_object(
            'owner_role', p.role,
            'owner_is_superbob', coalesce(p.is_superbob, false),
            'owner_name', coalesce(nullif(btrim(p.full_name), ''), p.email, ''),
            'is_owner', hn.owner_id = auth.uid()
          )
  from public.handler_notes hn
  join public.profiles p on p.id = hn.owner_id
  where hn.owner_id = auth.uid()
     or public.note_shared_with_caller(hn.id)
  order by hn.pinned desc, hn.updated_at desc;
$$;
grant execute on function public.list_visible_notes() to authenticated;

-- ---------- 5. Saved labels catalogue ----------
create table if not exists public.note_labels (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists note_labels_owner_name_uniq
  on public.note_labels(owner_id, lower(name));
create index if not exists note_labels_owner_idx on public.note_labels(owner_id);

alter table public.note_labels enable row level security;

drop policy if exists "note_labels read staff" on public.note_labels;
create policy "note_labels read staff" on public.note_labels
  for select using (public.is_internal_staff() or owner_id = auth.uid());

drop policy if exists "note_labels write owner" on public.note_labels;
create policy "note_labels write owner" on public.note_labels
  for all using (public.is_bob() or owner_id = auth.uid())
  with check (public.is_bob() or owner_id = auth.uid());

-- ---------- 6. Realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.handler_note_shares;
exception when duplicate_object then null;
end $$;

-- ---------- 7. Backfill existing shared_with_ads notes ----------
-- Every note a Super Boss shared with Ads Managers becomes a role='ads_manager'
-- share row so it surfaces through the new path immediately.
insert into public.handler_note_shares (note_id, target_kind, target_role)
select hn.id, 'role', 'ads_manager'
from public.handler_notes hn
join public.profiles p on p.id = hn.owner_id
where hn.shared_with_ads
  and p.role = 'bob' and p.is_superbob
on conflict do nothing;
