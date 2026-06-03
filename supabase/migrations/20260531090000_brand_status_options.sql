-- =========================================================
-- Afflix Core — new brand status options
--   active      -> in_progress
--   new_account -> onboarding
--   inactive    -> closed
--   (new)          paused  (Temporarily Paused)
-- "closed" is the read-only state (replaces the old "inactive").
-- =========================================================

-- Drop any CHECK constraint that pins client_status to the old values.
do $$
declare cn text;
begin
  for cn in
    select conname from pg_constraint
    where conrelid = 'public.brands'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%client_status%'
  loop
    execute format('alter table public.brands drop constraint %I', cn);
  end loop;
end $$;

update public.brands set client_status = 'in_progress' where client_status = 'active';
update public.brands set client_status = 'onboarding'  where client_status = 'new_account';
update public.brands set client_status = 'closed'      where client_status = 'inactive';
update public.brands set client_status = 'in_progress' where client_status is null;

alter table public.brands alter column client_status set default 'in_progress';

alter table public.brands
  add constraint brands_client_status_check
  check (client_status in ('onboarding', 'in_progress', 'paused', 'closed'));
