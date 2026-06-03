-- =========================================================
-- Afflix Core - Share links: per-link toggle for monthly reports
-- New column mirrors include_reports (weekly) and include_resources.
-- Default false so existing links keep their current behaviour
-- (weekly + resources only) until Bob explicitly opts in.
-- =========================================================

alter table public.report_share_links
  add column if not exists include_monthly_reports boolean not null default false;
