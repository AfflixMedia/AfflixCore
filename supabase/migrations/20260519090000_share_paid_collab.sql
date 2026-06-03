-- =========================================================
-- Afflix Core - Share Paid Collab with clients.
--
-- 1. Add `include_paid_collab` to report_share_links, mirroring the
--    existing weekly / monthly / resources include flags.
-- 2. Create a new `paid_program_threads` table for read-only program
--    conversations between staff and shared-link clients. The client
--    inserts via an edge function (service role + token validation);
--    staff insert via the RLS policy below.
-- =========================================================

alter table public.report_share_links
  add column if not exists include_paid_collab boolean not null default false;

create table if not exists public.paid_program_threads (
  id             uuid primary key default gen_random_uuid(),
  program_id     uuid not null references public.paid_creator_programs(id) on delete cascade,
  share_link_id  uuid references public.report_share_links(id) on delete set null,
  author_type    text not null check (author_type in ('client', 'staff')),
  author_name    text not null,
  body           text not null,
  parent_id      uuid references public.paid_program_threads(id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index if not exists ppt_program_idx on public.paid_program_threads(program_id);
create index if not exists ppt_parent_idx  on public.paid_program_threads(parent_id);

alter table public.paid_program_threads enable row level security;

-- Staff (Bob, APC, paid_collab_client, paid_collab_handler — anyone with
-- brand access to the program's brand) can read and write threads.
drop policy if exists "ppt staff all" on public.paid_program_threads;
create policy "ppt staff all" on public.paid_program_threads
  for all
  using (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_threads.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_threads.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  );
