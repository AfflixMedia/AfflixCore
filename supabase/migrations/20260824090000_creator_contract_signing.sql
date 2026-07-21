-- Creator contract e-signing links (Paid Collab handler workspace)
--
-- The handler generates a shareable link per creator deal; the creator opens it
-- (no account), reads the exact contract that was generated, types their name,
-- draws / uploads a signature and confirms ONCE. After that the signature is
-- frozen (server refuses a second sign) and the creator can only download the
-- signed PDF. The handler can deactivate / reactivate the link at any time and
-- is notified when a creator signs.
--
-- `payload` is the ContractInput snapshot built by the front end when the link
-- was created (brand, username, amount, videos, products, handler signature …),
-- so the PDF the creator signs can never drift from what they read.
--
-- Public access happens ONLY through the service-role edge functions
-- get-creator-contract / sign-creator-contract. RLS here is staff-only.

create table if not exists public.handler_contract_signatures (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid not null unique references public.handler_collab_creators(id) on delete cascade,
  brand_id           uuid not null references public.brands(id) on delete cascade,
  token              text not null unique,
  active             boolean not null default true,
  payload            jsonb not null default '{}'::jsonb,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- filled once, by the creator, through the public edge function
  signed_at          timestamptz,
  signer_name        text,
  signer_signature   text,   -- PNG data URL (drawn on canvas or rasterized SVG)
  signer_user_agent  text
);

create index if not exists hcs_brand_idx on public.handler_contract_signatures(brand_id);
create index if not exists hcs_token_idx on public.handler_contract_signatures(token);

alter table public.handler_contract_signatures enable row level security;

-- Bob + the brand's assigned handler(s) manage links; other internal staff with
-- brand access (APC / Team Lead / ads manager) can read the signing status.
drop policy if exists "hcs write" on public.handler_contract_signatures;
create policy "hcs write" on public.handler_contract_signatures
  for all
  using (public.writes_paid_collab_brand(brand_id))
  with check (public.writes_paid_collab_brand(brand_id));

drop policy if exists "hcs staff read" on public.handler_contract_signatures;
create policy "hcs staff read" on public.handler_contract_signatures
  for select
  using (public.is_internal_staff() and public.user_has_brand_access(brand_id));

create or replace function public.handler_contract_signatures_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists handler_contract_signatures_touch on public.handler_contract_signatures;
create trigger handler_contract_signatures_touch
  before update on public.handler_contract_signatures
  for each row execute function public.handler_contract_signatures_touch();
