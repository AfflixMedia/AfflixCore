-- =========================================================
-- Afflix Core - Brand-level product catalog + program ↔ product
-- mapping + per-video product reference.
--
-- Brand products live on the brand (visible to anyone with brand
-- access). Paid creator programs attach a subset of these
-- products. Each paid creator video is tied to one product so we
-- can attribute performance back to a SKU.
-- =========================================================

-- 1. Brand-level product catalog (the new Products tab on Brand Detail)
create table if not exists public.brand_products (
  id                   uuid primary key default gen_random_uuid(),
  brand_id             uuid not null references public.brands(id) on delete cascade,
  external_product_id  text,
  name                 text not null,
  price                numeric(12,2),
  focus                text not null default 'non_focus'
                       check (focus in ('focus', 'non_focus')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists bp_brand_idx on public.brand_products(brand_id);

drop trigger if exists bp_updated_at on public.brand_products;
create trigger bp_updated_at
  before update on public.brand_products
  for each row execute function public.set_updated_at();

alter table public.brand_products enable row level security;

drop policy if exists "bp scoped" on public.brand_products;
create policy "bp scoped" on public.brand_products
  for all
  using (public.user_has_brand_access(brand_id))
  with check (public.user_has_brand_access(brand_id));

-- 2. Junction: which brand products a paid creator program promotes.
--    Cascading deletes keep things tidy when programs or products go.
create table if not exists public.paid_program_products (
  program_id  uuid not null references public.paid_creator_programs(id) on delete cascade,
  product_id  uuid not null references public.brand_products(id)        on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (program_id, product_id)
);
create index if not exists ppp_product_idx on public.paid_program_products(product_id);

alter table public.paid_program_products enable row level security;

drop policy if exists "ppp scoped" on public.paid_program_products;
create policy "ppp scoped" on public.paid_program_products
  for all
  using (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_products.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  )
  with check (
    exists (
      select 1 from public.paid_creator_programs p
      where p.id = paid_program_products.program_id
        and public.user_has_brand_access(p.brand_id)
    )
  );

-- 3. Each paid creator video can reference one product (nullable for
--    legacy rows; UI requires it for new videos).
alter table public.paid_creator_videos
  add column if not exists product_id uuid references public.brand_products(id) on delete set null;
create index if not exists pcv_product_idx on public.paid_creator_videos(product_id);
