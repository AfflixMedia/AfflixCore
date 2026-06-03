-- =========================================================
-- Afflix Core - Link weekly/monthly reports to optional canvas templates.
--
-- Phase 3 of Reporting Canvas: every report can optionally point at a
-- canvas template. When template_id IS NULL the report keeps its legacy
-- structure exactly as before — nothing else changes. When set, the
-- renderer overlays the template above the legacy content.
-- =========================================================

alter table public.weekly_reports
  add column if not exists template_id uuid
  references public.report_templates(id) on delete set null;

alter table public.monthly_reports
  add column if not exists template_id uuid
  references public.report_templates(id) on delete set null;

create index if not exists weekly_reports_template_idx
  on public.weekly_reports(template_id) where template_id is not null;

create index if not exists monthly_reports_template_idx
  on public.monthly_reports(template_id) where template_id is not null;
