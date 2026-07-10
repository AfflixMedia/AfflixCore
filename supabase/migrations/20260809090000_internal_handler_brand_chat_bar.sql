-- =========================================================
-- Afflix Core — brand-chat header strip for INTERNAL paid-collab handlers.
--
-- Internal handlers are members of their brands' chat groups, but the strip
-- under the chat header (samples ring, GMV Max ring, Products, Reports,
-- Tasks) self-hid for them: no RLS read access to the tables it queries.
-- Give them READ-ONLY access, scoped strictly to THEIR assigned brands via
-- internal_handler_has_brand(b_id) (20260718 — checks is_internal_handler()
-- + paid_collab_handler_brands, so EXTERNAL handlers gain nothing).
--
-- Already covered elsewhere (no change here):
--   • brand_products      — "bp scoped" uses user_has_brand_access()
--   • weekly_reports read — "wr read paid collab handler" (20260624093000)
--   • tasks               — 20260717 handler policies (created/assigned rows)
--
-- Mirrors the Ads Manager read grants (20260725), minus resources/etc.
-- =========================================================

-- ---------- samples (strip ring + Samples popup) ----------
drop policy if exists "bsp internal_handler read" on public.brand_samples_products;
create policy "bsp internal_handler read" on public.brand_samples_products
  for select using (public.internal_handler_has_brand(brand_id));

drop policy if exists "bspd internal_handler read" on public.brand_samples_periods;
create policy "bspd internal_handler read" on public.brand_samples_periods
  for select using (public.internal_handler_has_brand(brand_id));

drop policy if exists "bsd internal_handler read" on public.brand_samples_daily;
create policy "bsd internal_handler read" on public.brand_samples_daily
  for select using (public.internal_handler_has_brand(brand_id));

drop policy if exists "bswg internal_handler read" on public.brand_samples_weekly_gmv;
create policy "bswg internal_handler read" on public.brand_samples_weekly_gmv
  for select using (public.internal_handler_has_brand(brand_id));

-- ---------- GMV Max (strip ring + GMV popup) ----------
drop policy if exists "bgmm internal_handler read" on public.brand_gmv_max_monthly;
create policy "bgmm internal_handler read" on public.brand_gmv_max_monthly
  for select using (public.internal_handler_has_brand(brand_id));

drop policy if exists "bgmw internal_handler read" on public.brand_gmv_max_weekly;
create policy "bgmw internal_handler read" on public.brand_gmv_max_weekly
  for select using (public.internal_handler_has_brand(brand_id));

-- ---------- monthly reports (Reports popup list — status only) ----------
-- Handlers do NOT get the /reporting routes; the popup lists reports without
-- navigation, so no report_comments access is needed.
drop policy if exists "mr internal_handler read" on public.monthly_reports;
create policy "mr internal_handler read" on public.monthly_reports
  for select using (public.internal_handler_has_brand(brand_id));
