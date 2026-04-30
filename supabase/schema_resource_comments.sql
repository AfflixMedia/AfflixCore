-- =========================================================
-- Afflix Core - Resource Comments
-- Mirrors report_comments. Clients can comment on shared resources via edge function.
-- Run AFTER schema_resources.sql.
-- =========================================================

create table if not exists public.resource_comments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  parent_id uuid references public.resource_comments(id) on delete cascade,
  author_type text not null check (author_type in ('client','bob','apc')),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists rsc_resource_idx on public.resource_comments(resource_id);
create index if not exists rsc_parent_idx on public.resource_comments(parent_id);

alter table public.resource_comments enable row level security;

-- Bob: full access
drop policy if exists "rsc bob all" on public.resource_comments;
create policy "rsc bob all" on public.resource_comments
  for all using (public.is_bob()) with check (public.is_bob());

-- APC: read/write comments on resources where the underlying resource is visible to them
-- (general resources, or brand-scope resources for their assigned brands).
drop policy if exists "rsc apc read" on public.resource_comments;
create policy "rsc apc read" on public.resource_comments
  for select using (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (
          r.scope = 'general'
          or exists (
            select 1 from public.apc_brands ab
            where ab.brand_id = r.brand_id and ab.apc_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "rsc apc insert" on public.resource_comments;
create policy "rsc apc insert" on public.resource_comments
  for insert with check (
    exists (
      select 1 from public.resources r
      where r.id = resource_comments.resource_id
        and (
          r.scope = 'general'
          or exists (
            select 1 from public.apc_brands ab
            where ab.brand_id = r.brand_id and ab.apc_id = auth.uid()
          )
        )
    )
  );

-- Public clients post via edge function with service-role key (no public RLS needed).

-- Realtime publication so the dashboard updates live when a client posts
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'resource_comments'
  ) then
    alter publication supabase_realtime add table public.resource_comments;
  end if;
end $$;
