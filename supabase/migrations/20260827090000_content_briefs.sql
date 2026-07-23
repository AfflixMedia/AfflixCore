-- =========================================================
-- Afflix Core — AI Content Briefs: saved, editable, shareable
--
-- Step 2 of the AI content-brief feature (step 1 = the access flag in
-- 20260826090000). The generated brief is no longer a throwaway: it is saved,
-- editable in the app, and publishable behind a read-only public link that
-- renders it as a web page (no .docx, no download step for the creator).
--
-- Mirrors the handler_contract_signatures pattern (20260824090000):
--   * staff-only RLS on the table
--   * a random `share_token` + `share_enabled` flag
--   * public read happens ONLY through the service-role edge function
--     `get-shared-brief`, never through anon RLS
--
-- ADDITIVE — no existing data or policies are dropped.
-- Apply with: supabase db push  (or paste into the SQL editor)
--
-- NOTE: three older migration timestamps are duplicated across two files each
-- (20260706 / 20260809 / 20260810), so `supabase db push` may report them as
-- pending. Workaround in CLAUDE.local.md §10 — temporarily move the
-- alphabetically-later file of each pair out of supabase/migrations/.
-- =========================================================

create table if not exists public.content_briefs (
  id            uuid primary key default gen_random_uuid(),
  -- Nullable: the Super Boss can draft a brief for a brand that is not yet in
  -- `brands` (a pitch, a prospect). brand_name is therefore the display source
  -- of truth, and the FK is a link, not a requirement.
  brand_id      uuid references public.brands(id) on delete set null,
  brand_name    text not null,
  month         text,                      -- 'YYYY-MM', the workspace month it was made for
  website_url   text,
  logo_url      text,
  title         text,
  -- The brief itself, Markdown. Written by Claude, then edited by hand.
  body          text not null default '',
  -- The exact inputs the brief was generated from, so a regenerate/audit can
  -- see what Claude was given (brand, links, selling priority, …).
  inputs        jsonb not null default '{}'::jsonb,
  -- Public read-only link. Token exists from creation; `share_enabled` gates it,
  -- so sharing can be revoked and re-enabled without the URL changing.
  share_token   text not null unique default replace(gen_random_uuid()::text, '-', ''),
  share_enabled boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists cb_brand_idx  on public.content_briefs(brand_id);
create index if not exists cb_token_idx  on public.content_briefs(share_token);
create index if not exists cb_author_idx on public.content_briefs(created_by);

alter table public.content_briefs enable row level security;

-- ---------- RLS ----------
-- Authors manage their own briefs. `can_use_ai_brief()` (20260826090000) is the
-- access gate, so revoking a handler's flag immediately stops new writes; the
-- created_by arm keeps a handler from touching another handler's drafts.
drop policy if exists "cb author all" on public.content_briefs;
create policy "cb author all" on public.content_briefs
  for all
  using (public.can_use_ai_brief() and created_by = auth.uid())
  with check (public.can_use_ai_brief() and created_by = auth.uid());

-- The Super Boss oversees every brief (same oversight pattern as
-- "handler_notes superbob ads all" in 20260801090000).
drop policy if exists "cb superbob all" on public.content_briefs;
create policy "cb superbob all" on public.content_briefs
  for all
  using (public.is_superbob())
  with check (public.is_superbob());

-- Internal staff with access to the brand can READ its briefs (Bob / APC /
-- Team Lead / ads manager see what the handler wrote for their brand).
-- Deliberately read-only: editing stays with the author and the Super Boss.
drop policy if exists "cb staff read" on public.content_briefs;
create policy "cb staff read" on public.content_briefs
  for select
  using (
    brand_id is not null
    and public.is_internal_staff()
    and public.user_has_brand_access(brand_id)
  );

-- NOTE: there is deliberately NO anon/public policy. The public read view goes
-- through the `get-shared-brief` edge function under the service role, which
-- checks share_enabled itself. That keeps the token the only credential and
-- avoids exposing the table to the anon key.

-- ---------- updated_at ----------
create or replace function public.content_briefs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists content_briefs_touch on public.content_briefs;
create trigger content_briefs_touch
  before update on public.content_briefs
  for each row execute function public.content_briefs_touch();

-- ---------- author default ----------
-- Stamps created_by server-side so a client cannot write a brief as someone
-- else (the author arm of "cb author all" then actually means something).
create or replace function public.content_briefs_fill_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists content_briefs_fill_author on public.content_briefs;
create trigger content_briefs_fill_author
  before insert on public.content_briefs
  for each row execute function public.content_briefs_fill_author();
