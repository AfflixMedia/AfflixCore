-- =========================================================
-- Afflix Core - Custom Section Presets (shared library)
-- Run after schema_report_v2.sql.
-- =========================================================

create table if not exists public.section_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,                             -- preset name
  payload jsonb not null,                         -- CustomSection definition (no rows / no body)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists section_presets_created_at_idx on public.section_presets(created_at desc);

alter table public.section_presets enable row level security;

-- Any authenticated user can read and create presets (shared library across users)
drop policy if exists "presets read auth" on public.section_presets;
create policy "presets read auth" on public.section_presets
  for select using (auth.role() = 'authenticated');

drop policy if exists "presets insert auth" on public.section_presets;
create policy "presets insert auth" on public.section_presets
  for insert with check (auth.role() = 'authenticated');

-- Only Bob or the original creator can delete a preset
drop policy if exists "presets delete owner_or_bob" on public.section_presets;
create policy "presets delete owner_or_bob" on public.section_presets
  for delete using (created_by = auth.uid() or public.is_bob());
