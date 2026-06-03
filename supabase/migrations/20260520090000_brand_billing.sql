-- =========================================================
-- Afflix Core — Brand Billing / Budget Manager
-- Tracks the monthly management fee per brand and which months
-- have been paid. One row per (brand, month) when a payment lands;
-- absence of a row for an active brand in a given month = "pending".
-- Bob-only — financial data is not exposed to APCs.
-- =========================================================

-- 1. Monthly fee on the brand itself (USD, 2dp).
alter table public.brands
  add column if not exists monthly_fee numeric(10, 2) not null default 0;

-- 2. Payment log — one row per brand per month when paid.
create table if not exists public.brand_payments (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Stored as the first day of the billing month, e.g. '2026-05-01'.
  month date not null,
  -- Amount that was actually paid (may differ from the brand's fee
  -- if the client paid more / less / pro-rated).
  amount numeric(10, 2) not null default 0,
  paid_at timestamptz not null default now(),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, month)
);

create index if not exists brand_payments_brand_idx
  on public.brand_payments(brand_id);
create index if not exists brand_payments_month_idx
  on public.brand_payments(month);

drop trigger if exists brand_payments_updated_at on public.brand_payments;
create trigger brand_payments_updated_at
  before update on public.brand_payments
  for each row execute function public.set_updated_at();

alter table public.brand_payments enable row level security;

drop policy if exists "brand_payments bob all" on public.brand_payments;
create policy "brand_payments bob all" on public.brand_payments
  for all using (public.is_bob()) with check (public.is_bob());
