-- =========================================================
-- Afflix Core — revert the "continue collab next month" feature.
--
-- The feature (migration 20260630090000) was rolled back. This drops the schema
-- objects it added. Idempotent (if exists) so it's a safe no-op on databases that
-- never had them. Creator data is intentionally left untouched.
-- =========================================================

drop function if exists public.handler_collab_continue_collab(uuid, text);

alter table public.handler_collab_brand_months
  drop column if exists continue_next_month;
