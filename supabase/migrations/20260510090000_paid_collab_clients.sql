-- =========================================================
-- Afflix Core - Paid Collab Client role
--
-- Adds a new role `paid_collab_client` (separate stakeholder from APC).
-- Bob can create these clients and assign them brands. Each client
-- only ever sees the Paid Collab data for their assigned brands —
-- no weekly/monthly reports, no other Brand Detail tabs.
--
-- Mirrors the apc_brands assignment table + RLS pattern.
-- =========================================================

-- 1. Mapping table: which brands a Paid Collab Client can see
create table if not exists public.paid_collab_client_brands (
  client_id uuid not null references public.profiles(id) on delete cascade,
  brand_id  uuid not null references public.brands(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (client_id, brand_id)
);

create index if not exists pcc_brands_client_idx on public.paid_collab_client_brands(client_id);
create index if not exists pcc_brands_brand_idx  on public.paid_collab_client_brands(brand_id);

alter table public.paid_collab_client_brands enable row level security;

drop policy if exists "pcc_brands bob all" on public.paid_collab_client_brands;
create policy "pcc_brands bob all" on public.paid_collab_client_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "pcc_brands self read" on public.paid_collab_client_brands;
create policy "pcc_brands self read" on public.paid_collab_client_brands
  for select using (client_id = auth.uid());

-- 2. Brands visibility: extend the existing scoped policy so that
--    paid_collab_client users can also read their assigned brands.
--    (Bob + APC scoping is preserved.)
drop policy if exists "brands read scoped" on public.brands;
create policy "brands read scoped" on public.brands
  for select using (
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = brands.id and ab.apc_id = auth.uid()
    )
    or exists (
      select 1 from public.paid_collab_client_brands pcb
      where pcb.brand_id = brands.id and pcb.client_id = auth.uid()
    )
  );
