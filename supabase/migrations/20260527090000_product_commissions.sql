-- =========================================================
-- Afflix Core — Brand product commissions
-- Each product can carry a Standard commission and a Shop Ads
-- commission (both stored as a percentage). Shop Ads commission
-- can be flagged "not set".
-- =========================================================

alter table public.brand_products
  add column if not exists standard_commission numeric(6, 2) not null default 0;

alter table public.brand_products
  add column if not exists shop_ads_commission numeric(6, 2) not null default 0;

alter table public.brand_products
  add column if not exists shop_ads_commission_not_set boolean not null default false;
