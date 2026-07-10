-- =========================================================
-- Afflix Core — Fix user deletion, part 2 (storage.objects.owner)
--
-- 20260720 fixed the six public-schema FKs, but "Database error deleting
-- user" persisted. Remaining blocker: storage.objects.owner references
-- auth.users(id) with NO "on delete" rule (older Supabase storage schema),
-- so deleting any user who ever UPLOADED a file — a report image
-- ('report-images' bucket) or a profile photo ('avatars', 20260709) —
-- aborts the whole auth.admin.deleteUser() transaction.
--
-- Fix: re-create that FK with ON DELETE SET NULL. Uploaded files are KEPT
-- (report images stay embedded in reports); only the owner column clears.
--
-- Also prints a diagnostic NOTICE for EVERY remaining FK (any schema) that
-- references auth.users or public.profiles without CASCADE / SET NULL /
-- SET DEFAULT, so the `supabase db push` output shows whether anything
-- else can still block a user delete.
-- =========================================================

do $$
declare
  r record;
  cname text;
begin
  -- ---------- 1. Diagnostic: FKs that can still block a user delete ----------
  for r in
    select nsp.nspname  as sch,
           rel.relname  as tbl,
           con.conname  as con,
           tnsp.nspname as tsch,
           trel.relname as ttbl,
           con.confdeltype as del
    from pg_constraint con
    join pg_class rel       on rel.oid  = con.conrelid
    join pg_namespace nsp   on nsp.oid  = rel.relnamespace
    join pg_class trel      on trel.oid = con.confrelid
    join pg_namespace tnsp  on tnsp.oid = trel.relnamespace
    where con.contype = 'f'
      and con.confdeltype in ('a', 'r')  -- NO ACTION / RESTRICT
      and ((tnsp.nspname = 'auth' and trel.relname = 'users')
        or (tnsp.nspname = 'public' and trel.relname = 'profiles'))
  loop
    raise notice 'BLOCKING FK: %.% constraint % -> %.% (no delete rule)',
      r.sch, r.tbl, r.con, r.tsch, r.ttbl;
  end loop;

  -- ---------- 2. storage.objects.owner → ON DELETE SET NULL ----------
  select con.conname into cname
  from pg_constraint con
  join pg_class rel     on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'storage'
    and rel.relname = 'objects'
    and con.contype = 'f'
    and con.confdeltype in ('a', 'r')
    and exists (
      select 1 from unnest(con.conkey) k
      join pg_attribute a on a.attrelid = rel.oid and a.attnum = k
      where a.attname = 'owner'
    )
  limit 1;

  if cname is null then
    raise notice 'storage.objects.owner FK already has a delete rule (or no FK) — nothing to do';
  else
    begin
      execute format('alter table storage.objects drop constraint %I', cname);
      execute format(
        'alter table storage.objects add constraint %I foreign key (owner) references auth.users(id) on delete set null',
        cname);
      raise notice 'FIXED: storage.objects.% re-created with ON DELETE SET NULL', cname;
    exception when insufficient_privilege then
      -- postgres may not own storage.objects on some stacks; if so this
      -- NOTICE shows in the push output and we fall back to clearing owner
      -- rows from the delete-* edge functions instead.
      raise notice 'NO PRIVILEGE to alter storage.objects — FK left unchanged';
    end;
  end if;
end $$;
