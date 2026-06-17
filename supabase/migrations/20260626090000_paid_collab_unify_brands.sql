-- =========================================================
-- Afflix Core — Unify Paid Collab onto public.brands (one brand list).
--
-- Removes the separate handler brand list (handler_collab_brands) and re-keys
-- the handler workspace data (handler_collab_brand_months / handler_collab_creators)
-- onto public.brands. A brand is "paid-collab-enabled" when its existing scope
-- contains 'paid_creator' (the brand form's "Paid Collabs" checkbox) — no new column.
-- Brands are assigned to handlers/clients via the EXISTING assignment tables
-- (paid_collab_handler_brands / paid_collab_client_brands).
--
-- DESTRUCTIVE: existing handler data whose brand name is NOT present in public.brands
-- is permanently deleted, and handler_collab_brands is dropped. Snapshot first.
--
-- Other systems (APC, Team Lead, paid_creator_* ) are untouched: we reuse the
-- existing public.user_has_brand_access() helper and DO NOT modify it.
-- =========================================================

-- ---------- 1. Name-match map (handler brand id -> public brand id) ----------
drop table if exists _hc_map;
create temporary table _hc_map as
select hb.id as handler_brand_id, b.id as public_brand_id, hb.handler_id
from public.handler_collab_brands hb
join public.brands b on lower(btrim(b.name)) = lower(btrim(hb.name));

-- Enable (add 'paid_creator' scope) + assign every matched brand to its owning handler.
update public.brands
set scope = array_append(scope, 'paid_creator')
where id in (select public_brand_id from _hc_map)
  and not (scope @> array['paid_creator']);

insert into public.paid_collab_handler_brands (handler_id, brand_id)
select distinct handler_id, public_brand_id from _hc_map
on conflict do nothing;

-- ---------- 3. Re-key the data onto public.brands ----------
-- Drop FK + the (brand_id, month) unique first, so remapping two handler brands onto one
-- public brand doesn't trip the unique constraint mid-UPDATE (we dedupe right after).
alter table public.handler_collab_brand_months drop constraint if exists handler_collab_brand_months_brand_id_fkey;
alter table public.handler_collab_brand_months drop constraint if exists handler_collab_brand_months_brand_id_month_key;
alter table public.handler_collab_creators     drop constraint if exists handler_collab_creators_brand_id_fkey;

update public.handler_collab_brand_months m
set brand_id = map.public_brand_id
from _hc_map map where m.brand_id = map.handler_brand_id;

update public.handler_collab_creators c
set brand_id = map.public_brand_id
from _hc_map map where c.brand_id = map.handler_brand_id;

-- Discard rows whose brand had no public.brands match (still a handler brand id).
delete from public.handler_collab_brand_months where brand_id not in (select id from public.brands);
delete from public.handler_collab_creators     where brand_id not in (select id from public.brands);

-- Two handler brands could map to one public brand → dedupe months on (brand_id, month).
delete from public.handler_collab_brand_months a
using public.handler_collab_brand_months b
where a.brand_id = b.brand_id and a.month = b.month and a.ctid > b.ctid;

alter table public.handler_collab_brand_months
  add constraint handler_collab_brand_months_brand_id_month_key unique (brand_id, month);
alter table public.handler_collab_brand_months
  add constraint handler_collab_brand_months_brand_id_fkey
  foreign key (brand_id) references public.brands(id) on delete cascade;
alter table public.handler_collab_creators
  add constraint handler_collab_creators_brand_id_fkey
  foreign key (brand_id) references public.brands(id) on delete cascade;

-- ---------- 4. RLS: scope by public.brands access ----------
-- Read = anyone with brand access (bob/apc/client/handler). Write = bob or assigned handler.
create or replace function public.writes_paid_collab_brand(b_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.is_bob() or exists (
    select 1 from public.paid_collab_handler_brands
    where brand_id = b_id and handler_id = auth.uid()
  );
$$;
revoke all on function public.writes_paid_collab_brand(uuid) from public;
grant execute on function public.writes_paid_collab_brand(uuid) to authenticated;

-- Drop the old (owns_handler_collab_brand + client_id) policies.
drop policy if exists handler_collab_brand_months_select        on public.handler_collab_brand_months;
drop policy if exists handler_collab_brand_months_insert        on public.handler_collab_brand_months;
drop policy if exists handler_collab_brand_months_update        on public.handler_collab_brand_months;
drop policy if exists handler_collab_brand_months_delete        on public.handler_collab_brand_months;
drop policy if exists handler_collab_brand_months_client_select on public.handler_collab_brand_months;
drop policy if exists handler_collab_creators_select        on public.handler_collab_creators;
drop policy if exists handler_collab_creators_insert        on public.handler_collab_creators;
drop policy if exists handler_collab_creators_update        on public.handler_collab_creators;
drop policy if exists handler_collab_creators_delete        on public.handler_collab_creators;
drop policy if exists handler_collab_creators_client_select on public.handler_collab_creators;

create policy handler_collab_brand_months_select on public.handler_collab_brand_months
  for select to authenticated using (public.user_has_brand_access(brand_id));
create policy handler_collab_brand_months_insert on public.handler_collab_brand_months
  for insert to authenticated with check (public.writes_paid_collab_brand(brand_id));
create policy handler_collab_brand_months_update on public.handler_collab_brand_months
  for update to authenticated using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));
create policy handler_collab_brand_months_delete on public.handler_collab_brand_months
  for delete to authenticated using (public.writes_paid_collab_brand(brand_id));

create policy handler_collab_creators_select on public.handler_collab_creators
  for select to authenticated using (public.user_has_brand_access(brand_id));
create policy handler_collab_creators_insert on public.handler_collab_creators
  for insert to authenticated with check (public.writes_paid_collab_brand(brand_id));
create policy handler_collab_creators_update on public.handler_collab_creators
  for update to authenticated using (public.writes_paid_collab_brand(brand_id)) with check (public.writes_paid_collab_brand(brand_id));
create policy handler_collab_creators_delete on public.handler_collab_creators
  for delete to authenticated using (public.writes_paid_collab_brand(brand_id));

-- ---------- 5. Drop the obsolete brand table + helper ----------
drop function if exists public.owns_handler_collab_brand(uuid);
drop table if exists public.handler_collab_brands cascade;  -- also drops its policies + realtime entry

drop table if exists _hc_map;
