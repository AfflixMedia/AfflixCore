-- =========================================================
-- Afflix Core — Paid Collab creator performance
-- Per-creator weekly + monthly performance entries (GMV + items sold).
-- Weekly entries advance on a per-creator anchor (chosen the first time,
-- then +7 days each subsequent week — same idea as weekly reports).
-- Scoped exactly like creator videos: Bob, assigned APC, paid-collab client.
-- =========================================================

-- Per-creator weekly anchor — the start date of their first tracked week.
alter table public.paid_creators
  add column if not exists weekly_perf_anchor date;

create table if not exists public.paid_creator_performance (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.paid_creators(id) on delete cascade,
  period_type  text not null check (period_type in ('weekly', 'monthly')),
  -- weekly: the week start date; monthly: the first day of the month.
  period_start date not null,
  gmv          numeric(12, 2) not null default 0,
  items_sold   int not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (creator_id, period_type, period_start)
);

create index if not exists pcperf_creator_idx
  on public.paid_creator_performance(creator_id);

drop trigger if exists pcperf_updated_at on public.paid_creator_performance;
create trigger pcperf_updated_at
  before update on public.paid_creator_performance
  for each row execute function public.set_updated_at();

alter table public.paid_creator_performance enable row level security;

drop policy if exists "pcperf scoped" on public.paid_creator_performance;
create policy "pcperf scoped" on public.paid_creator_performance
  for all
  using (
    exists (
      select 1
      from public.paid_creators c
      join public.paid_creator_programs p on p.id = c.program_id
      where c.id = paid_creator_performance.creator_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1
      from public.paid_creators c
      join public.paid_creator_programs p on p.id = c.program_id
      where c.id = paid_creator_performance.creator_id
        and public.user_has_brand_access(p.brand_id)
    )
  );
