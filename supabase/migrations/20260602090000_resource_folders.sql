-- =========================================================
-- Afflix Core - Resource folder management + pinning
--
-- Adds a `resource_folders` tree (per brand or general scope)
-- so Bob/APCs can organize resources hierarchically. Each
-- resource can live in a folder (folder_id = null means root)
-- and can be pinned for quick access at the top of its folder.
-- Folders themselves can be pinned and nested.
-- =========================================================

-- 1. Folders table — self-referential tree, scoped same as resources.
create table if not exists public.resource_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  scope       text not null check (scope in ('general','brand')),
  brand_id    uuid references public.brands(id) on delete cascade,
  parent_id   uuid references public.resource_folders(id) on delete cascade,
  pinned      boolean not null default false,
  sort_order  int not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint resource_folders_scope_brand_ck check (
    (scope = 'general' and brand_id is null)
    or (scope = 'brand' and brand_id is not null)
  )
);

create index if not exists resource_folders_parent_idx on public.resource_folders(parent_id);
create index if not exists resource_folders_brand_idx  on public.resource_folders(brand_id);
create index if not exists resource_folders_scope_idx  on public.resource_folders(scope);
create index if not exists resource_folders_pinned_idx on public.resource_folders(pinned) where pinned;

drop trigger if exists resource_folders_updated_at on public.resource_folders;
create trigger resource_folders_updated_at
  before update on public.resource_folders
  for each row execute function public.set_updated_at();

-- 2. RLS on folders — mirrors `resources` rules.
alter table public.resource_folders enable row level security;

drop policy if exists "rf bob all" on public.resource_folders;
create policy "rf bob all" on public.resource_folders
  for all using (public.is_bob()) with check (public.is_bob());

-- APCs: read+write general folders, plus folders for brands they're assigned to.
drop policy if exists "rf apc general all" on public.resource_folders;
create policy "rf apc general all" on public.resource_folders
  for all using (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc')
    )
  ) with check (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc')
    )
  );

drop policy if exists "rf apc brand all" on public.resource_folders;
create policy "rf apc brand all" on public.resource_folders
  for all using (
    scope = 'brand' and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resource_folders.brand_id and ab.apc_id = auth.uid()
    )
  ) with check (
    scope = 'brand' and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resource_folders.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 3. Add folder + pinned + sort_order columns to existing resources.
alter table public.resources
  add column if not exists folder_id  uuid references public.resource_folders(id) on delete set null,
  add column if not exists pinned     boolean not null default false,
  add column if not exists sort_order int not null default 0;

create index if not exists resources_folder_idx on public.resources(folder_id);
create index if not exists resources_pinned_idx on public.resources(pinned) where pinned;

-- 4. APC write policies on resources — they could already read general; this
--    explicitly grants them write access in general scope and brand scope.
drop policy if exists "resources apc general write" on public.resources;
create policy "resources apc general write" on public.resources
  for all using (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc')
    )
  ) with check (
    scope = 'general' and exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role in ('bob','apc')
    )
  );

drop policy if exists "resources apc brand write" on public.resources;
create policy "resources apc brand write" on public.resources
  for all using (
    scope = 'brand' and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  ) with check (
    scope = 'brand' and exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = resources.brand_id and ab.apc_id = auth.uid()
    )
  );

-- 5. Backfill — convert existing `general_folder` text values into real folder
--    rows, and update each resource's `folder_id` to point at the new row.
do $$
declare
  rec record;
  fid uuid;
begin
  for rec in
    select distinct general_folder
    from public.resources
    where scope = 'general'
      and general_folder is not null
      and trim(general_folder) <> ''
  loop
    insert into public.resource_folders (name, scope)
      values (rec.general_folder, 'general')
      returning id into fid;
    update public.resources
      set folder_id = fid
      where scope = 'general' and general_folder = rec.general_folder;
  end loop;
end $$;
