-- Brand region (US / UK / EURO) — the single field a Bob/APC picks that fixes
-- the money symbol shown for the brand EVERYWHERE (reports, paid collab, share
-- links, contracts): US → $, UK → £, EURO → €. Default US.
--
-- brands.currency (added in 20260810_brand_currency) stays the technical field
-- every money formatter already reads; it is kept in sync with the region here
-- and on every save (US→USD, UK→GBP, EURO→EUR), so the existing report currency
-- machinery keeps working with no downstream change.

alter table public.brands
  add column if not exists region text not null default 'US';

-- Backfill region from the currency already on file: GBP → UK, EUR → EURO,
-- everything else (USD and any legacy code) → US. Runs once; the ALTER above
-- defaulted every existing row to 'US', so derive the real region from currency.
update public.brands
  set region = case upper(coalesce(currency, 'USD'))
                 when 'GBP'  then 'UK'
                 when 'EUR'  then 'EURO'
                 else 'US'
               end
  where id is not null;

-- Normalise currency to match the region (US→USD, UK→GBP, EURO→EUR). This folds
-- any legacy currency (CAD/AUD/…) into the 3-region model so region + currency
-- never disagree.
update public.brands
  set currency = case region
                   when 'UK'   then 'GBP'
                   when 'EURO' then 'EUR'
                   else 'USD'
                 end
  where currency is distinct from (case region
                                     when 'UK'   then 'GBP'
                                     when 'EURO' then 'EUR'
                                     else 'USD'
                                   end);

-- Enforce the 3-region domain going forward.
alter table public.brands
  drop constraint if exists brands_region_check;
alter table public.brands
  add constraint brands_region_check check (region in ('US', 'UK', 'EURO'));
