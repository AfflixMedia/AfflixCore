-- Section presets v2: also support standard sections, not just custom ones.
-- Existing rows are custom presets — back-compat default.

alter table public.section_presets
  add column if not exists kind text not null default 'custom';

alter table public.section_presets
  add column if not exists section_id text;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'section_presets_kind_check'
      and table_name = 'section_presets'
  ) then
    alter table public.section_presets
      add constraint section_presets_kind_check
      check (kind in ('custom','standard'));
  end if;
end $$;

create index if not exists section_presets_kind_idx on public.section_presets(kind, section_id);
