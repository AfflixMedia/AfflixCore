-- =========================================================
-- Afflix Core - Resource sharing toggle (per-resource is_shared)
-- Mirrors weekly_reports.is_shared. Gated by brands.share_enabled.
-- Run AFTER schema_resources.sql + schema_brand_detail.sql.
-- =========================================================

alter table public.resources
  add column if not exists is_shared boolean not null default false;

create index if not exists resources_is_shared_idx
  on public.resources(brand_id) where is_shared = true;
