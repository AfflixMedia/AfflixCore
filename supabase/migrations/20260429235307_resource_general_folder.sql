-- Resources: user-named folders for general-scope resources.
-- Brand-scope resources are still organised by brand_id; this is only for general.

alter table public.resources
  add column if not exists general_folder text;

-- Backfill any existing general resources to a default folder so they don't disappear
-- from the UI's folder grid.
update public.resources
  set general_folder = 'General'
  where scope = 'general' and (general_folder is null or general_folder = '');

create index if not exists resources_general_folder_idx
  on public.resources(general_folder)
  where scope = 'general';
