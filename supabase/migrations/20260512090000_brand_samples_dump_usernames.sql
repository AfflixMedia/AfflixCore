-- =========================================================
-- Afflix Core - Sample Seeding: dump_usernames per day
--
-- Adds a text column where users paste the list of approved
-- creator usernames for the day (one per line). Used by the
-- CSV export so they can download a usernames+date list for
-- any date range.
-- =========================================================

alter table public.brand_samples_daily
  add column if not exists dump_usernames text;
