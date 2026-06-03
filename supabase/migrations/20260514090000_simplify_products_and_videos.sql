-- =========================================================
-- Afflix Core - Simplify brand products + paid creator videos
--
-- Brand products: drop the unused `price` and `focus` columns and
-- add a per-product TikTok link instead.
--
-- Paid creator videos: drop the manual performance metrics
-- (gmv / items_sold / views / likes / comments) — the team only
-- needs the link, status, posted date, and free-form notes.
-- =========================================================

alter table public.brand_products
  drop column if exists price,
  drop column if exists focus,
  add column if not exists tiktok_link text;

alter table public.paid_creator_videos
  drop column if exists gmv,
  drop column if exists items_sold,
  drop column if exists views,
  drop column if exists likes,
  drop column if exists comments;
