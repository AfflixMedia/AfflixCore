-- =========================================================
-- Afflix Core - Paid creator programs: name + end-of-program.
--
-- `name` lets a brand have several distinguishable programs at once.
-- `ended_at` flips a program into read-only "completed" mode — once
-- set, no creators / videos / notes / details can be added or edited.
-- Bob and the assigned Paid Collab Client can both end / reopen.
-- =========================================================

alter table public.paid_creator_programs
  add column if not exists name      text,
  add column if not exists ended_at  timestamptz;

create index if not exists pcp_ended_idx on public.paid_creator_programs(ended_at);
