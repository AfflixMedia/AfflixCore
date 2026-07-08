-- =========================================================
-- Sample seeding: per-MONTH product-level goals.
-- brand_samples_products.monthly_goal was a single global value per
-- product, so a goal entered while viewing one month showed in every
-- month. New jsonb column monthly_goals maps 'YYYY-MM' -> goal (same
-- pattern as handler_collab_creators.monthly). The legacy monthly_goal
-- column is kept but no longer read or written by the app.
-- No RLS changes needed: existing row policies on
-- brand_samples_products cover the new column.
-- =========================================================

alter table public.brand_samples_products
  add column if not exists monthly_goals jsonb not null default '{}'::jsonb;

-- Backfill: copy each product's legacy global goal into every month its
-- brand was active in (any daily entry or a monthly total-goal row), plus
-- the current month — so nothing changes visually on existing data; the
-- goals just become independently editable per month from now on.
with brand_months as (
  select brand_id, to_char(entry_date, 'YYYY-MM') as month
    from public.brand_samples_daily
  union
  select brand_id, month
    from public.brand_samples_periods
  union
  select id as brand_id, to_char(now(), 'YYYY-MM') as month
    from public.brands
),
goals as (
  select p.id, jsonb_object_agg(bm.month, to_jsonb(p.monthly_goal)) as g
    from public.brand_samples_products p
    join brand_months bm on bm.brand_id = p.brand_id
   where p.monthly_goal is not null
   group by p.id
)
update public.brand_samples_products p
   set monthly_goals = goals.g
  from goals
 where goals.id = p.id
   and p.monthly_goals = '{}'::jsonb;
