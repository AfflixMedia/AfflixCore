-- Per-link toggles: which categories of content this share link exposes.
-- Existing links default to including both (current behaviour).

alter table public.report_share_links
  add column if not exists include_reports   boolean not null default true,
  add column if not exists include_resources boolean not null default true;
