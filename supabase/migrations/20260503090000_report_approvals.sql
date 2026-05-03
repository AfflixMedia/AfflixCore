-- =========================================================
-- Afflix Core - Report approval flow for shared links
-- Per (report × share_link) decision row. Bob + assigned APCs read.
-- Inserts come via the post-approval-decision edge function (service role).
-- =========================================================

create table if not exists public.report_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.weekly_reports(id) on delete cascade,
  share_link_id uuid not null references public.report_share_links(id) on delete cascade,
  decision text not null check (decision in ('approved', 'changes_requested')),
  comment text,
  decided_by_name text not null,
  decided_at timestamptz not null default now(),
  unique (report_id, share_link_id)
);

create index if not exists rad_report_idx on public.report_approval_decisions(report_id);
create index if not exists rad_link_idx on public.report_approval_decisions(share_link_id);

alter table public.report_approval_decisions enable row level security;

drop policy if exists "rad bob read" on public.report_approval_decisions;
create policy "rad bob read" on public.report_approval_decisions
  for select using (public.is_bob());

drop policy if exists "rad apc read" on public.report_approval_decisions;
create policy "rad apc read" on public.report_approval_decisions
  for select using (
    exists (
      select 1
      from public.weekly_reports r
      join public.apc_brands ab on ab.brand_id = r.brand_id
      where r.id = report_approval_decisions.report_id
        and ab.apc_id = auth.uid()
    )
  );
