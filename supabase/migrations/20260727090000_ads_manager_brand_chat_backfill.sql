-- =========================================================
-- Afflix Core — Backfill: existing Ads Managers into their brand chat groups
--
-- 20260726 taught sync_brand_chat_group() to include the brand's Ads
-- Manager(s) as members and added the deferred ads_manager_brands_sync_chat
-- trigger, so any NEW assignment (via set_ads_manager_brands or the
-- create-ads-manager edge fn) adds them to the brand group automatically.
--
-- But an Ads Manager who was already assigned brands BEFORE that sync path
-- existed never had their group roster reconciled — the trigger only fires on
-- fresh insert/delete, and 20260726 only re-synced brands whose assignment it
-- *removed* for the GMV-Max scope rule. This backfill re-runs the sync for
-- every brand that currently has an Ads Manager, adding them (idempotent —
-- a no-op for anyone already a member).
-- =========================================================
do $$
declare b record;
begin
  for b in
    select distinct amb.brand_id
      from public.ads_manager_brands amb
      join public.brands br on br.id = amb.brand_id
  loop
    perform public.sync_brand_chat_group(b.brand_id);
  end loop;
end $$;
