-- =========================================================
-- Afflix Core - Reporting Canvas (Phase 1: schema + storage).
--
-- Visual template builder for custom report layouts. Lives ALONGSIDE the
-- existing weekly/monthly reporting system — never replaces it. Reports
-- can opt in to a template at creation time; otherwise they keep using
-- the legacy structure.
--
-- Layout model: Canva-style grid (every block has %-width x/w + px y/h).
-- Storage: a single JSONB schema column. Each block carries its own
--   { id, type, layout, props, children } shape.
-- Metrics: blocks reference an enumerated metric catalog (GMV, items,
--   etc.) for data binding — the actual values resolve at render time.
-- Brand linking: many-to-many. A template can be global, or limited to
--   specific brands.
-- =========================================================

create table if not exists public.report_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  -- Which legacy reporting flow this template stands in for. Lets the
  -- template picker only surface relevant options on the right page.
  report_kind     text not null default 'weekly'
                    check (report_kind in ('weekly', 'monthly', 'custom')),
  -- When true, every brand the viewer can access may use this template
  -- (in addition to anything explicitly linked via report_template_brands).
  is_global       boolean not null default false,
  -- The full canvas tree. Versioned via schema_version so we can migrate
  -- shape changes without rewriting every row at once.
  schema_json     jsonb not null default jsonb_build_object(
                    'version', 1,
                    'canvas', jsonb_build_object('width', 1200, 'background', '#ffffff'),
                    'blocks', '[]'::jsonb
                  ),
  schema_version  int not null default 1,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists report_templates_kind_idx on public.report_templates(report_kind);
create index if not exists report_templates_global_idx on public.report_templates(is_global) where is_global;

drop trigger if exists rt_updated_at on public.report_templates;
create trigger rt_updated_at
  before update on public.report_templates
  for each row execute function public.set_updated_at();

-- Many-to-many: template <-> brand. Empty for global templates.
create table if not exists public.report_template_brands (
  template_id uuid not null references public.report_templates(id) on delete cascade,
  brand_id    uuid not null references public.brands(id)            on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (template_id, brand_id)
);

create index if not exists rtb_brand_idx on public.report_template_brands(brand_id);

-- RLS — templates -------------------------------------------------------------
alter table public.report_templates enable row level security;

drop policy if exists "rt bob all" on public.report_templates;
create policy "rt bob all" on public.report_templates
  for all using (public.is_bob()) with check (public.is_bob());

-- Anyone (APC / Handler / Client) can read templates that are global, or
-- explicitly linked to one of their accessible brands.
drop policy if exists "rt visible read" on public.report_templates;
create policy "rt visible read" on public.report_templates
  for select using (
    is_global
    or exists (
      select 1 from public.report_template_brands rtb
      where rtb.template_id = report_templates.id
        and public.user_has_brand_access(rtb.brand_id)
    )
  );

-- RLS — template/brand join --------------------------------------------------
alter table public.report_template_brands enable row level security;

drop policy if exists "rtb bob all" on public.report_template_brands;
create policy "rtb bob all" on public.report_template_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "rtb scoped read" on public.report_template_brands;
create policy "rtb scoped read" on public.report_template_brands
  for select using (public.user_has_brand_access(brand_id));
