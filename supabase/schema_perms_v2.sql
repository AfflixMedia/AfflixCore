-- =========================================================
-- Afflix Core - Permissions v2
-- Run AFTER schema.sql, schema_apc.sql, schema_resources.sql, schema_comments.sql
-- =========================================================

-- 1. profiles: per-APC flag — can this APC edit brand details?
alter table public.profiles
  add column if not exists can_edit_brands boolean not null default false;

-- 2. brands: allow APCs with the flag to update brands assigned to them
drop policy if exists "brands apc update" on public.brands;
create policy "brands apc update" on public.brands
  for update using (
    exists (
      select 1
      from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_edit_brands = true
        and ab.brand_id = brands.id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.apc_brands ab on ab.apc_id = p.id
      where p.id = auth.uid()
        and p.can_edit_brands = true
        and ab.brand_id = brands.id
    )
  );

-- 3. resources: APCs can manage brand-scope resources for their assigned brands
drop policy if exists "resources apc insert" on public.resources;
create policy "resources apc insert" on public.resources
  for insert with check (
    scope = 'brand'
    and brand_id is not null
    and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "resources apc update" on public.resources;
create policy "resources apc update" on public.resources
  for update using (
    scope = 'brand'
    and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  )
  with check (
    scope = 'brand'
    and brand_id is not null
    and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  );

drop policy if exists "resources apc delete" on public.resources;
create policy "resources apc delete" on public.resources
  for delete using (
    scope = 'brand'
    and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 4. report_comments: allow custom-section ids (free-form section text)
alter table public.report_comments
  drop constraint if exists report_comments_section_check;
