-- =========================================================
-- Afflix Core — GMV Max weekly entries become PRODUCT-LEVEL.
--
-- Each weekly GMV Max entry (brand_gmv_max_weekly) now breaks down into
-- per-product rows: every brand product ("focus products") plus a single
-- catch-all "Other Products" row. Each row carries its own
-- ad_spend / roi / orders / cpo / gmv, editable at product level.
--
-- The parent brand_gmv_max_weekly row keeps its ad_spend/roi/orders/cpo/gmv
-- columns but they are now AUTO-CALCULATED from the child rows (a trigger
-- recomputes them on any child insert/update/delete). This keeps the weekly
-- report "Fetch from brand" pull (WeeklyReportEdit) working unchanged:
--   - ad_spend / orders / gmv  = SUM of the product rows
--   - roi                       = total gmv / total ad_spend   (0 if no spend)
--   - cpo                       = total ad_spend / total orders (0 if no orders)
--
-- Existing weekly rows are preserved: their current totals are migrated into
-- a single "Other Products" child so nothing is lost.
-- =========================================================

create table if not exists public.brand_gmv_max_weekly_products (
  id          uuid primary key default gen_random_uuid(),
  weekly_id   uuid not null references public.brand_gmv_max_weekly(id) on delete cascade,
  product_id  uuid references public.brand_products(id) on delete set null,
  is_other    boolean not null default false,   -- true = the "Other Products" catch-all row
  ad_spend    numeric(14,2) not null default 0,
  roi         numeric(10,4) not null default 0,
  orders      integer       not null default 0,
  cpo         numeric(14,2) not null default 0,
  gmv         numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bgmwp_weekly_idx on public.brand_gmv_max_weekly_products(weekly_id);
-- One row per product per week, and at most one "Other Products" row per week.
create unique index if not exists bgmwp_weekly_product_uidx
  on public.brand_gmv_max_weekly_products(weekly_id, product_id) where product_id is not null;
create unique index if not exists bgmwp_weekly_other_uidx
  on public.brand_gmv_max_weekly_products(weekly_id) where is_other;

drop trigger if exists bgmwp_updated_at on public.brand_gmv_max_weekly_products;
create trigger bgmwp_updated_at
  before update on public.brand_gmv_max_weekly_products
  for each row execute function public.set_updated_at();

-- ---------- Recompute the parent weekly totals from the product rows ----------
create or replace function public.gmv_max_weekly_recompute() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_weekly uuid := coalesce(new.weekly_id, old.weekly_id);
  v_spend  numeric(14,2);
  v_orders integer;
  v_gmv    numeric(14,2);
begin
  select coalesce(sum(ad_spend), 0), coalesce(sum(orders), 0), coalesce(sum(gmv), 0)
    into v_spend, v_orders, v_gmv
    from public.brand_gmv_max_weekly_products
   where weekly_id = v_weekly;

  update public.brand_gmv_max_weekly w
     set ad_spend = v_spend,
         orders   = v_orders,
         gmv      = v_gmv,
         roi      = case when v_spend  > 0 then round(v_gmv   / v_spend,  4) else 0 end,
         cpo      = case when v_orders > 0 then round(v_spend / v_orders, 2) else 0 end,
         updated_at = now()
   where w.id = v_weekly;

  return null;
end $$;

drop trigger if exists bgmwp_recompute on public.brand_gmv_max_weekly_products;
create trigger bgmwp_recompute
  after insert or update or delete on public.brand_gmv_max_weekly_products
  for each row execute function public.gmv_max_weekly_recompute();

-- ---------- RLS: mirror the parent brand_gmv_max_weekly access, gated by parent ----------
alter table public.brand_gmv_max_weekly_products enable row level security;

-- Read: bob / team_lead / ads_manager / assigned apc of the parent's brand.
drop policy if exists "bgmwp read" on public.brand_gmv_max_weekly_products;
create policy "bgmwp read" on public.brand_gmv_max_weekly_products
  for select using (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (
            select 1 from public.apc_brands ab
            where ab.brand_id = w.brand_id and ab.apc_id = auth.uid()
          )
        )
    )
  );

-- Write: bob / team_lead / ads_manager / apc-with-can_manage_gmv_max of the parent's brand.
drop policy if exists "bgmwp write" on public.brand_gmv_max_weekly_products;
create policy "bgmwp write" on public.brand_gmv_max_weekly_products
  for all using (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (
            select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid()
              and p.can_manage_gmv_max = true
              and ab.brand_id = w.brand_id
          )
        )
    )
  ) with check (
    exists (
      select 1 from public.brand_gmv_max_weekly w
      where w.id = brand_gmv_max_weekly_products.weekly_id
        and (
          public.is_bob()
          or public.team_lead_has_brand(w.brand_id)
          or public.ads_manager_has_brand(w.brand_id)
          or exists (
            select 1 from public.profiles p
            join public.apc_brands ab on ab.apc_id = p.id
            where p.id = auth.uid()
              and p.can_manage_gmv_max = true
              and ab.brand_id = w.brand_id
          )
        )
    )
  );

-- ---------- Backfill: preserve existing weekly totals as an "Other Products" row ----------
insert into public.brand_gmv_max_weekly_products (weekly_id, is_other, ad_spend, roi, orders, cpo, gmv)
select w.id, true, w.ad_spend, w.roi, w.orders, w.cpo, w.gmv
from public.brand_gmv_max_weekly w
where not exists (
  select 1 from public.brand_gmv_max_weekly_products c where c.weekly_id = w.id
);
