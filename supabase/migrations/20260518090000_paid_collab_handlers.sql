-- =========================================================
-- Afflix Core - Paid Collab Handler role.
--
-- Operations role for staff who manage paid collab data day-to-day:
-- create/end programs, add creators, add videos, edit metrics.
-- Bob creates handlers and assigns brands to each. Same RLS pattern
-- as APC + Paid Collab Client.
-- =========================================================

create table if not exists public.paid_collab_handler_brands (
  handler_id  uuid not null references public.profiles(id) on delete cascade,
  brand_id    uuid not null references public.brands(id)   on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (handler_id, brand_id)
);
create index if not exists pchb_handler_idx on public.paid_collab_handler_brands(handler_id);
create index if not exists pchb_brand_idx   on public.paid_collab_handler_brands(brand_id);

alter table public.paid_collab_handler_brands enable row level security;

drop policy if exists "pchb bob all" on public.paid_collab_handler_brands;
create policy "pchb bob all" on public.paid_collab_handler_brands
  for all using (public.is_bob()) with check (public.is_bob());

drop policy if exists "pchb self read" on public.paid_collab_handler_brands;
create policy "pchb self read" on public.paid_collab_handler_brands
  for select using (handler_id = auth.uid());

-- Extend user_has_brand_access so handlers can read/write paid collab data
-- for their assigned brands (programs, creators, videos, notes, products).
create or replace function public.user_has_brand_access(b_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    public.is_bob()
    or exists (
      select 1 from public.apc_brands ab
      where ab.brand_id = b_id and ab.apc_id = auth.uid()
    )
    or exists (
      select 1 from public.paid_collab_client_brands pcb
      where pcb.brand_id = b_id and pcb.client_id = auth.uid()
    )
    or exists (
      select 1 from public.paid_collab_handler_brands pchb
      where pchb.brand_id = b_id and pchb.handler_id = auth.uid()
    );
$$;

-- Brands visibility: handlers see brands they're assigned to.
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
    or exists (
      select 1 from public.paid_collab_handler_brands pchb
      where pchb.brand_id = brands.id and pchb.handler_id = auth.uid()
    )
  );
