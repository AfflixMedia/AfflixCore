-- =========================================================
-- Afflix Core — Paid Collab handler: persisted brand ordering
--
-- Stores each handler's custom drag-and-drop order of the brand list in the
-- handler workspace, so the order follows the account across devices (instead of
-- per-browser localStorage). One row per (handler, brand) with a position.
--
-- Personal data: each user reads/writes only their own rows (Bob can read all for
-- oversight). 100% additive — new table only.
-- =========================================================

create table if not exists public.handler_collab_brand_order (
  handler_id uuid not null references public.profiles(id) on delete cascade,
  brand_id   uuid not null references public.brands(id)   on delete cascade,
  position   int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (handler_id, brand_id)
);
create index if not exists handler_collab_brand_order_handler_idx
  on public.handler_collab_brand_order(handler_id);

alter table public.handler_collab_brand_order enable row level security;

create policy hcbo_select on public.handler_collab_brand_order
  for select to authenticated
  using (handler_id = auth.uid() or public.is_bob());
create policy hcbo_insert on public.handler_collab_brand_order
  for insert to authenticated
  with check (handler_id = auth.uid());
create policy hcbo_update on public.handler_collab_brand_order
  for update to authenticated
  using (handler_id = auth.uid())
  with check (handler_id = auth.uid());
create policy hcbo_delete on public.handler_collab_brand_order
  for delete to authenticated
  using (handler_id = auth.uid() or public.is_bob());
