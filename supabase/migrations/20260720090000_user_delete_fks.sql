-- =========================================================
-- Afflix Core — Fix "sometimes can't delete a user" (400 from delete-* fns)
--
-- Root cause: six FKs reference auth.users(id) with NO "on delete" rule
-- (default NO ACTION), so auth.admin.deleteUser() aborts with "Database
-- error deleting user" whenever the target ever created one of these rows:
--   brands.created_by, weekly_reports.created_by (also NOT NULL!),
--   resources.created_by, resource_folders.created_by,
--   section_presets.created_by, report_share_links.created_by
-- Fresh accounts deleted fine — anyone who had authored a report/resource
-- didn't. Every delete-* edge fn (APC / Team Lead / paid-collab / Bob) was
-- affected.
--
-- Fix: re-create those FKs with ON DELETE SET NULL (the convention the
-- newer tables already follow, e.g. monthly_reports.created_by), and drop
-- the NOT NULL on weekly_reports.created_by. The deleted user's reports,
-- brands, resources and share links are KEPT — creator just shows as "—".
--
-- ADDITIVE / data-safe. Apply with: supabase db push
-- =========================================================

alter table public.weekly_reports alter column created_by drop not null;

do $$
declare
  r record;
  cname text;
begin
  for r in
    select * from (values
      ('brands',             'created_by'),
      ('weekly_reports',     'created_by'),
      ('resources',          'created_by'),
      ('resource_folders',   'created_by'),
      ('section_presets',    'created_by'),
      ('report_share_links', 'created_by')
    ) as v(tbl, col)
  loop
    -- Find the existing FK on (tbl.col) whatever it was named.
    select con.conname into cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = r.tbl
      and con.contype = 'f'
      and exists (
        select 1 from unnest(con.conkey) k
        join pg_attribute a on a.attrelid = rel.oid and a.attnum = k
        where a.attname = r.col
      )
    limit 1;

    if cname is not null then
      execute format('alter table public.%I drop constraint %I', r.tbl, cname);
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      r.tbl, r.tbl || '_' || r.col || '_fkey', r.col
    );
    cname := null;
  end loop;
end $$;
