-- Share link mode: 'brand' (current — pick brands, auto-include reports/resources)
-- or 'general' (Bob explicitly picks general-scope resources to share, no brand tie-in).

alter table public.report_share_links
  add column if not exists link_mode text not null default 'brand';

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'report_share_links_link_mode_check'
      and table_name = 'report_share_links'
  ) then
    alter table public.report_share_links
      add constraint report_share_links_link_mode_check
      check (link_mode in ('brand','general'));
  end if;
end $$;
