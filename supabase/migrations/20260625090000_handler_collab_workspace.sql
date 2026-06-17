-- =========================================================
-- Afflix Core — Paid Collab Handler workspace (full migration from the
-- standalone "afflix-base" tool into AfflixCore's own Supabase project).
--
-- New, self-contained tables (NOT linked to public.brands — this is a
-- separate roster owned per-handler, mirroring the standalone tool's
-- "100% separate" design):
--   handler_collab_brands        — one row per brand a handler manages
--   handler_collab_brand_months  — per-brand, per-calendar-month budget/links
--   handler_collab_creators      — creators/deals onboarded under a brand
--
-- Per-handler scoping: handler_collab_brands.handler_id references
-- profiles(id). Bob has full oversight; each paid_collab_handler is
-- restricted to their own brands (and rows that hang off them) via the
-- owns_handler_collab_brand() SECURITY DEFINER helper.
--
-- 100% ADDITIVE: new tables only. Does not touch paid_creator_programs /
-- paid_creators / paid_collab_handler_brands or any existing table.
-- =========================================================

-- ---------- 1. Tables ----------
create table public.handler_collab_brands (
  id          uuid primary key default gen_random_uuid(),
  handler_id  uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index handler_collab_brands_handler_idx on public.handler_collab_brands(handler_id);

create table public.handler_collab_brand_months (
  id                 uuid primary key default gen_random_uuid(),
  brand_id           uuid not null references public.handler_collab_brands(id) on delete cascade,
  month              text not null,                 -- 'YYYY-MM'
  budget             numeric not null default 0,
  content_guide_url  text not null default '',
  focus_product_url  text not null default '',      -- JSON text: [{"name","url"}]
  notes              text not null default '',
  unique (brand_id, month)
);

create table public.handler_collab_creators (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.handler_collab_brands(id) on delete cascade,
  name           text not null,
  tiktok_handle  text not null default '',
  amount         numeric not null default 0,
  videos_count   int not null default 0,
  zelle          text not null default '',
  paypal         text not null default '',
  phone          text not null default '',
  email          text not null default '',
  category       text not null default '',
  payment_status text not null default 'videos_in_progress'
    check (payment_status in ('videos_in_progress', 'pending', 'paid')),
  onboarded_on   date,
  completed_on   date,
  video_codes    jsonb not null default '[]'::jsonb,  -- [{video, adCode, auth?}]
  products       jsonb not null default '[]'::jsonb,  -- [{name, url}]
  monthly        jsonb not null default '{}'::jsonb,  -- {"YYYY-MM": {gmv, adSpent}}
  created_at     timestamptz not null default now()
);
create index handler_collab_creators_brand_idx on public.handler_collab_creators(brand_id);
create index handler_collab_creators_onboarded_idx on public.handler_collab_creators(onboarded_on);

-- ---------- 2. Access helper ----------
create or replace function public.owns_handler_collab_brand(b_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_bob() or exists (
    select 1 from public.handler_collab_brands
    where id = b_id and handler_id = auth.uid()
  );
$$;
revoke all on function public.owns_handler_collab_brand(uuid) from public;
grant execute on function public.owns_handler_collab_brand(uuid) to authenticated;

-- ---------- 3. RLS ----------
alter table public.handler_collab_brands       enable row level security;
alter table public.handler_collab_brand_months enable row level security;
alter table public.handler_collab_creators     enable row level security;

create policy handler_collab_brands_select on public.handler_collab_brands
  for select to authenticated
  using (public.is_bob() or handler_id = auth.uid());
create policy handler_collab_brands_insert on public.handler_collab_brands
  for insert to authenticated
  with check (public.is_bob() or handler_id = auth.uid());
create policy handler_collab_brands_update on public.handler_collab_brands
  for update to authenticated
  using (public.is_bob() or handler_id = auth.uid())
  with check (public.is_bob() or handler_id = auth.uid());
create policy handler_collab_brands_delete on public.handler_collab_brands
  for delete to authenticated
  using (public.is_bob() or handler_id = auth.uid());

create policy handler_collab_brand_months_select on public.handler_collab_brand_months
  for select to authenticated
  using (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_brand_months_insert on public.handler_collab_brand_months
  for insert to authenticated
  with check (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_brand_months_update on public.handler_collab_brand_months
  for update to authenticated
  using (public.owns_handler_collab_brand(brand_id))
  with check (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_brand_months_delete on public.handler_collab_brand_months
  for delete to authenticated
  using (public.owns_handler_collab_brand(brand_id));

create policy handler_collab_creators_select on public.handler_collab_creators
  for select to authenticated
  using (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_creators_insert on public.handler_collab_creators
  for insert to authenticated
  with check (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_creators_update on public.handler_collab_creators
  for update to authenticated
  using (public.owns_handler_collab_brand(brand_id))
  with check (public.owns_handler_collab_brand(brand_id));
create policy handler_collab_creators_delete on public.handler_collab_creators
  for delete to authenticated
  using (public.owns_handler_collab_brand(brand_id));

-- ---------- 4. Realtime ----------
alter publication supabase_realtime add table public.handler_collab_brands;
alter publication supabase_realtime add table public.handler_collab_brand_months;
alter publication supabase_realtime add table public.handler_collab_creators;
