-- Daily LIVE sessions count for a brand's Sample-Seeding log.
-- Additive: existing rows get NULL (treated as 0 when summed).
alter table public.brand_samples_daily
  add column if not exists live_sessions int;
