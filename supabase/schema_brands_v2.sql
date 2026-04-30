-- =========================================================
-- Afflix Core - Brands schema v2
-- New essential fields: scope (multi-tag), client_status, shop_code.
-- The legacy last_month_gmv / tier_* columns stay in place for back-compat
-- but are no longer collected or displayed in the UI.
-- =========================================================

alter table public.brands
  add column if not exists scope text[] not null default '{}'::text[];

alter table public.brands
  add column if not exists client_status text not null default 'active';

-- Constraint allows the three states the UI uses today; expand as needed.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'brands_client_status_check'
      and table_name = 'brands'
  ) then
    alter table public.brands
      add constraint brands_client_status_check
      check (client_status in ('active','new_account','inactive'));
  end if;
end $$;

alter table public.brands
  add column if not exists shop_code text;

create index if not exists brands_client_status_idx on public.brands(client_status);
create index if not exists brands_shop_code_idx on public.brands(shop_code);
