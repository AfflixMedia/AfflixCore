-- GMV Max monthly TARGET ROI — a per-brand, per-month ROI goal, set alongside
-- the allocated budget in the Brand Detail → GMV Max tab. The tab compares it
-- against the ACHIEVED ROI (sum of weekly GMV / sum of weekly ad spend) the same
-- way it already compares allocated budget vs spend-to-date.
--
-- Additive, back-compat: defaults to 0 (no goal) so every existing month row is
-- untouched. RLS is unchanged — the bob/apc/team_lead/ads_manager policies on
-- brand_gmv_max_monthly are all table-level (`for all`), so the new column rides
-- the existing read/write grants with no policy edits.

alter table public.brand_gmv_max_monthly
  add column if not exists target_roi numeric(10,4) not null default 0;
