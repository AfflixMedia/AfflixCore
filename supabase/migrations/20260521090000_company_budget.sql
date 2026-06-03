-- =========================================================
-- Afflix Core — Company Budget (Income Streams & Expenses)
-- Lives alongside brand_payments. Brand revenue is auto-summed
-- from brand_payments per month; this module captures non-brand
-- income sources and all company expenses with categories.
-- Bob-only.
-- =========================================================

-- 1. Manual income entries (non-brand revenue).
create table if not exists public.income_entries (
  id uuid primary key default gen_random_uuid(),
  month date not null,                       -- first day of the billing month
  source text not null,
  amount numeric(12, 2) not null default 0,
  received_at date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists income_entries_month_idx on public.income_entries(month);

drop trigger if exists income_entries_updated_at on public.income_entries;
create trigger income_entries_updated_at
  before update on public.income_entries
  for each row execute function public.set_updated_at();

alter table public.income_entries enable row level security;

drop policy if exists "income_entries bob all" on public.income_entries;
create policy "income_entries bob all" on public.income_entries
  for all using (public.is_bob()) with check (public.is_bob());


-- 2. Expense categories (user-extensible; ships with sane defaults).
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text default 'bi-tag',                -- bootstrap-icon class suffix
  color text default '#6e6e80',
  sort_order int not null default 100,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;

drop policy if exists "expense_categories bob all" on public.expense_categories;
create policy "expense_categories bob all" on public.expense_categories
  for all using (public.is_bob()) with check (public.is_bob());

-- Seed defaults — safe to re-run (on conflict do nothing).
insert into public.expense_categories (name, icon, color, sort_order, is_default) values
  ('Salaries',   'bi-people',         '#1d4ed8', 10, true),
  ('Bills',      'bi-receipt',        '#b45309', 20, true),
  ('Office',     'bi-building',       '#0e7490', 30, true),
  ('Marketing',  'bi-megaphone',      '#a21caf', 40, true),
  ('Software',   'bi-cpu',            '#15803d', 50, true),
  ('Misc',       'bi-three-dots',     '#475569', 90, true)
on conflict (name) do nothing;


-- 3. Individual expense entries.
create table if not exists public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  month date not null,                       -- first day of the billing month
  category_id uuid references public.expense_categories(id) on delete set null,
  label text not null,                       -- e.g. 'May salaries — Faheem'
  amount numeric(12, 2) not null default 0,
  spent_at date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expense_entries_month_idx on public.expense_entries(month);
create index if not exists expense_entries_category_idx on public.expense_entries(category_id);

drop trigger if exists expense_entries_updated_at on public.expense_entries;
create trigger expense_entries_updated_at
  before update on public.expense_entries
  for each row execute function public.set_updated_at();

alter table public.expense_entries enable row level security;

drop policy if exists "expense_entries bob all" on public.expense_entries;
create policy "expense_entries bob all" on public.expense_entries
  for all using (public.is_bob()) with check (public.is_bob());
