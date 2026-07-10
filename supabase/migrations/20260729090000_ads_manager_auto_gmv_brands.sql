-- =========================================================
-- Afflix Core — Ads Managers auto-receive ALL GMV Max brands
--
-- Change of model: instead of Bob hand-picking each Ads Manager's brands,
-- EVERY brand whose scope contains 'ads' (the GMV Max scope) is automatically
-- assigned to EVERY Ads Manager, kept in sync whenever a brand is created or
-- its scope is edited, and whenever an Ads Manager is created.
--
-- ads_manager_brands is now a derived table: it always equals
--   (every profile with role 'ads_manager') × (every brand with 'ads' scope).
-- reconcile_ads_manager_brands() rebuilds it to that state; triggers on brands
-- (insert / scope change) and profiles (role change) call it. Row changes here
-- still fire the deferred ads_manager_brands_sync_chat trigger from 20260726,
-- so each affected brand's chat-group roster follows automatically.
--
-- set_ads_manager_brands() is kept for compatibility but is no longer the
-- source of truth (the UI stops calling it; reconcile overrides any manual set
-- on the next brand/profile change).
-- =========================================================

-- ---------- Reconcile: ads_manager_brands = ads_managers × GMV-Max brands ----------
create or replace function public.reconcile_ads_manager_brands()
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Drop assignments that are no longer valid: the brand lost the 'ads' scope,
  -- or the profile is no longer an Ads Manager.
  delete from public.ads_manager_brands amb
   where not exists (
           select 1 from public.brands b
            where b.id = amb.brand_id and 'ads' = any(b.scope))
      or not exists (
           select 1 from public.profiles p
            where p.id = amb.ads_manager_id and p.role = 'ads_manager');

  -- Add every missing (Ads Manager × GMV-Max brand) pairing.
  insert into public.ads_manager_brands (ads_manager_id, brand_id)
  select p.id, b.id
    from public.profiles p
    cross join public.brands b
   where p.role = 'ads_manager'
     and 'ads' = any(b.scope)
     and not exists (
           select 1 from public.ads_manager_brands amb
            where amb.ads_manager_id = p.id and amb.brand_id = b.id);
end;
$$;
revoke all on function public.reconcile_ads_manager_brands() from public;

-- ---------- Triggers ----------
-- A brand is created or its scope changes → re-derive assignments.
create or replace function public.tg_brands_reconcile_ads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.reconcile_ads_manager_brands();
  return null;
end;
$$;

drop trigger if exists brands_reconcile_ads_insert on public.brands;
create trigger brands_reconcile_ads_insert
  after insert on public.brands
  for each statement execute function public.tg_brands_reconcile_ads();

drop trigger if exists brands_reconcile_ads_scope on public.brands;
create trigger brands_reconcile_ads_scope
  after update of scope on public.brands
  for each statement execute function public.tg_brands_reconcile_ads();

-- An Ads Manager is created (or a profile's role changes) → re-derive.
create or replace function public.tg_profiles_reconcile_ads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.reconcile_ads_manager_brands();
  return null;
end;
$$;

drop trigger if exists profiles_reconcile_ads on public.profiles;
create trigger profiles_reconcile_ads
  after insert or update of role on public.profiles
  for each statement execute function public.tg_profiles_reconcile_ads();

-- ---------- Backfill existing data ----------
select public.reconcile_ads_manager_brands();
