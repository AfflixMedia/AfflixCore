-- =========================================================
-- Afflix Core — Paid Collab comments
-- (brand / program(month) / week / creator / insights / kpi).
--
-- Threaded comments on the paid-collab data, shared between the public client
-- share link and the handler workspace. Mirrors report_comments:
--   • public client posts via the post-shared-paidcollab-comment edge function
--     (service role) which also notifies the brand's handler(s) + Bob.
--   • handlers / bob / apc post directly (RLS) from the workspace.
--
-- target_type + target_key locate the thread:
--   brand     -> key ''                  (whole brand)
--   program   -> key 'YYYY-MM'           (a brand-month / program)
--   week      -> key 'YYYY-MM-DD'        (a weekly-report week, by week_start)
--   creator   -> key = creator id
--   insights  -> key ''                  (Insights section)
--   kpi       -> key = kpi id ('gmv', 'active_creators', …)
-- =========================================================

create table if not exists public.paid_collab_comments (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  target_type text not null check (target_type in ('brand','program','week','creator','insights','kpi')),
  target_key  text not null default '',
  author_type text not null check (author_type in ('client','handler','bob','apc')),
  author_id   uuid references auth.users(id) on delete set null, -- null for public client
  author_name text not null,
  body        text not null,
  parent_id   uuid references public.paid_collab_comments(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists pcc_brand_idx  on public.paid_collab_comments(brand_id);
create index if not exists pcc_target_idx on public.paid_collab_comments(brand_id, target_type, target_key);

alter table public.paid_collab_comments enable row level security;

-- Read: anyone with access to the brand (bob / apc / client / handler).
drop policy if exists pcc_read on public.paid_collab_comments;
create policy pcc_read on public.paid_collab_comments
  for select to authenticated
  using (public.user_has_brand_access(brand_id));

-- Insert (authed staff/handler): must author as self, and be bob, the assigned
-- handler, or the assigned apc of the brand. Public clients insert via edge function.
drop policy if exists pcc_insert on public.paid_collab_comments;
create policy pcc_insert on public.paid_collab_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.is_bob()
      or public.writes_paid_collab_brand(brand_id)
      or exists (select 1 from public.apc_brands ab
                 where ab.brand_id = paid_collab_comments.brand_id and ab.apc_id = auth.uid())
    )
  );

-- Authors may delete their own comments (bob can delete any).
drop policy if exists pcc_delete_own on public.paid_collab_comments;
create policy pcc_delete_own on public.paid_collab_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_bob());
