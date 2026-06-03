-- =========================================================
-- Afflix Core — Paid Collab per-video performance
-- Each video gets its own weekly + monthly performance entries
-- (GMV + items sold), mirroring per-creator performance. Weekly
-- entries advance on a per-video anchor.
-- Editable by Bob, assigned APC, paid-collab client (and handler
-- via the same brand-access path as creator videos).
-- =========================================================

-- Per-video weekly anchor.
alter table public.paid_creator_videos
  add column if not exists weekly_perf_anchor date;

create table if not exists public.paid_video_performance (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references public.paid_creator_videos(id) on delete cascade,
  period_type  text not null check (period_type in ('weekly', 'monthly')),
  period_start date not null,
  gmv          numeric(12, 2) not null default 0,
  items_sold   int not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (video_id, period_type, period_start)
);

create index if not exists pvperf_video_idx
  on public.paid_video_performance(video_id);

drop trigger if exists pvperf_updated_at on public.paid_video_performance;
create trigger pvperf_updated_at
  before update on public.paid_video_performance
  for each row execute function public.set_updated_at();

alter table public.paid_video_performance enable row level security;

drop policy if exists "pvperf scoped" on public.paid_video_performance;
create policy "pvperf scoped" on public.paid_video_performance
  for all
  using (
    exists (
      select 1
      from public.paid_creator_videos v
      join public.paid_creators c on c.id = v.creator_id
      join public.paid_creator_programs p on p.id = c.program_id
      where v.id = paid_video_performance.video_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1
      from public.paid_creator_videos v
      join public.paid_creators c on c.id = v.creator_id
      join public.paid_creator_programs p on p.id = c.program_id
      where v.id = paid_video_performance.video_id
        and public.user_has_brand_access(p.brand_id)
    )
  );
