-- Per-brand display currency for reports (USD/EUR/GBP/…). Display-only: stored
-- GMV numbers are raw and unchanged; this only re-labels the symbol shown.
alter table public.brands
  add column if not exists currency text not null default 'USD';
