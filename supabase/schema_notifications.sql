-- =========================================================
-- Afflix Core - In-app notifications + push subscriptions
-- Run AFTER schema_comments.sql + schema_apc.sql
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,        -- 'client_comment' | 'reply' | future types
  title text not null,
  body text,
  link text,                 -- in-app route to navigate on click
  payload jsonb,             -- extra context (report_id, comment_id, brand_id…)
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications self read" on public.notifications;
create policy "notifications self read" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications self update" on public.notifications;
create policy "notifications self update" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications self delete" on public.notifications;
create policy "notifications self delete" on public.notifications
  for delete using (auth.uid() = user_id);

-- Bob can also see all (for an admin overview later if needed)
drop policy if exists "notifications bob read" on public.notifications;
create policy "notifications bob read" on public.notifications
  for select using (public.is_bob());

-- Push subscriptions for web push (Phase 2 — needs VAPID keys)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push subs self" on public.push_subscriptions;
create policy "push subs self" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Realtime: enable for notifications so frontend can subscribe to inserts
alter publication supabase_realtime add table public.notifications;
