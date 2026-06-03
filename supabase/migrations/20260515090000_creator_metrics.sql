-- =========================================================
-- Afflix Core - Add creator-level performance metrics on paid_creators.
-- Tracks the totals each creator has generated across all of their
-- videos for the program (entered manually).
-- =========================================================

alter table public.paid_creators
  add column if not exists gmv        numeric(12,2) not null default 0,
  add column if not exists items_sold int           not null default 0,
  add column if not exists likes      int           not null default 0;
