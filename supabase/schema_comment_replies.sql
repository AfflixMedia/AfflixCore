-- =========================================================
-- Afflix Core - Comment replies (threading)
-- Run AFTER schema_comments.sql
-- =========================================================

alter table public.report_comments
  add column if not exists parent_id uuid references public.report_comments(id) on delete cascade;

create index if not exists rc_parent_idx on public.report_comments(parent_id);
