-- =========================================================
-- Afflix Core — Lock down Brand Budget data
--
-- PROBLEM: `brands.monthly_fee` lived on the `brands` table, which
-- APCs can read (RLS is row-level — it cannot hide a single column).
-- So any APC could retrieve the management fee via a plain
-- `select('*')` or a direct API call.
--
-- FIX: move the fee into its own `brand_billing` table guarded by a
-- Bob-only RLS policy, then DROP the column from `brands` entirely.
-- After this, the fee is physically unreachable for non-Bob roles —
-- not hidden in the UI, but absent from every response they can make.
-- =========================================================

create table if not exists public.brand_billing (
  brand_id     uuid primary key references public.brands(id) on delete cascade,
  monthly_fee  numeric(10, 2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Carry over any fees already entered on the brands table.
insert into public.brand_billing (brand_id, monthly_fee)
  select id, coalesce(monthly_fee, 0) from public.brands
  on conflict (brand_id) do nothing;

drop trigger if exists brand_billing_updated_at on public.brand_billing;
create trigger brand_billing_updated_at
  before update on public.brand_billing
  for each row execute function public.set_updated_at();

alter table public.brand_billing enable row level security;

-- Bob-only — no other role has any access (read or write).
drop policy if exists "brand_billing bob all" on public.brand_billing;
create policy "brand_billing bob all" on public.brand_billing
  for all using (public.is_bob()) with check (public.is_bob());

-- Remove the leaky column from the APC-readable brands table.
alter table public.brands drop column if exists monthly_fee;
