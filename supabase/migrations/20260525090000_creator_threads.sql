-- =========================================================
-- Afflix Core — Paid Collab per-creator threads
-- A thread comment can now be scoped to a single creator.
--   creator_id NULL  → program-level (global) thread
--   creator_id SET   → that creator's own thread
-- =========================================================

alter table public.paid_program_threads
  add column if not exists creator_id uuid
    references public.paid_creators(id) on delete cascade;

create index if not exists ppt_creator_idx
  on public.paid_program_threads(creator_id);
