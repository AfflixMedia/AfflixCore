-- =========================================================
-- Afflix Core - Paid Creator Program tracker
--
-- Per-brand tracker for paid creator collabs:
--   programs           — one per brand (launch date, total budget)
--   creators           — name/handle/fee/deliverables/onboard
--   creator_videos     — manual TikTok URLs + manual GMV/items/views
--   program_notes      — delays/milestones/budget suggestions, optionally
--                        pinned to the cumulative chart
--
-- Editable by Bob, the assigned APC, and any assigned Paid Collab Client.
-- =========================================================

-- 1. Helper: does the current user have Paid-Collab access to this brand?
--    Bob always; APC if assigned via apc_brands; Paid Collab Client if
--    assigned via paid_collab_client_brands.
create or replace function public.user_has_brand_access(b_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = b_id and ab.apc_id = auth.uid()
    )
    or exists (
      select 1 from public.paid_collab_client_brands pcb
      where pcb.brand_id = b_id and pcb.client_id = auth.uid()
    );
$$;

-- 2. Programs (one row per brand for now; brand_id is not unique so we
--    can support multiple campaigns later)
create table if not exists public.paid_creator_programs (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brands(id) on delete cascade,
  launch_date date,
  total_budget numeric(12,2) default 0,
  currency    text not null default 'USD',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pcp_brand_idx on public.paid_creator_programs(brand_id);

drop trigger if exists pcp_updated_at on public.paid_creator_programs;
create trigger pcp_updated_at
  before update on public.paid_creator_programs
  for each row execute function public.set_updated_at();

alter table public.paid_creator_programs enable row level security;

drop policy if exists "pcp scoped" on public.paid_creator_programs;
create policy "pcp scoped" on public.paid_creator_programs
  for all
  using (public.user_has_brand_access(brand_id))
  with check (public.user_has_brand_access(brand_id));

-- 3. Creators
create table if not exists public.paid_creators (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references public.paid_creator_programs(id) on delete cascade,
  name          text not null,
  handle        text,
  fee           numeric(12,2) default 0,
  agreed_videos int default 0,
  onboard_date  date,
  status        text not null default 'active',
  notes         text,
  sort_order    int default 0,
  created_at    timestamptz not null default now()
);
create index if not exists pc_program_idx on public.paid_creators(program_id);

alter table public.paid_creators enable row level security;

drop policy if exists "pc scoped" on public.paid_creators;
create policy "pc scoped" on public.paid_creators
  for all
  using (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_creators.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_creators.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  );

-- 4. Per-creator videos (manual TikTok URLs + manual metrics)
create table if not exists public.paid_creator_videos (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid not null references public.paid_creators(id) on delete cascade,
  tiktok_url  text,
  status      text not null default 'pipeline',  -- pipeline | live
  posted_on   date,
  gmv         numeric(12,2) default 0,
  items_sold  int default 0,
  views       bigint default 0,
  likes       int default 0,
  comments    int default 0,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists pcv_creator_idx on public.paid_creator_videos(creator_id);
create index if not exists pcv_status_idx  on public.paid_creator_videos(status);
create index if not exists pcv_posted_idx  on public.paid_creator_videos(posted_on);

alter table public.paid_creator_videos enable row level security;

drop policy if exists "pcv scoped" on public.paid_creator_videos;
create policy "pcv scoped" on public.paid_creator_videos
  for all
  using (
    exists (
      select 1
      from public.paid_creators c
      join public.paid_creator_programs p on p.id = c.program_id
      where c.id = paid_creator_videos.creator_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1
      from public.paid_creators c
      join public.paid_creator_programs p on p.id = c.program_id
      where c.id = paid_creator_videos.creator_id
        and public.user_has_brand_access(p.brand_id)
    )
  );

-- 5. Program notes (delays / milestones / budget suggestions)
--    `kind` controls icon/colour and `pin_to_chart` decides whether the
--    note is rendered as a marker on the cumulative chart.
create table if not exists public.paid_program_notes (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references public.paid_creator_programs(id) on delete cascade,
  kind        text not null default 'note',
  title       text not null,
  body        text,
  occurred_on date,
  pin_to_chart boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ppn_program_idx on public.paid_program_notes(program_id);

alter table public.paid_program_notes enable row level security;

drop policy if exists "ppn scoped" on public.paid_program_notes;
create policy "ppn scoped" on public.paid_program_notes
  for all
  using (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_notes.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_notes.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  );
