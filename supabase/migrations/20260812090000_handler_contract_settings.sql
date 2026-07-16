-- Per-handler contract template settings (signature block only).
-- Every paid-collab handler (internal OR external — both live in the handler
-- workspace) sets the Brand Representative name + signature once via the
-- "Contract template" modal; the agreement PDFs they download then render
-- that signature in the Brand Representative block. The legal wording stays
-- code-generated — only the signature block is configurable (user call).
-- Signature images live in the existing public 'avatars' bucket under the
-- owner's uid folder (signature-<ts>.png) — its RLS already scopes writes.

create table if not exists public.handler_contract_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  rep_name text not null default '',
  signature_url text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.handler_contract_settings enable row level security;

drop policy if exists "hcs owner all" on public.handler_contract_settings;
create policy "hcs owner all" on public.handler_contract_settings
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Bob can review what each handler signs with.
drop policy if exists "hcs bob read" on public.handler_contract_settings;
create policy "hcs bob read" on public.handler_contract_settings
  for select using (public.is_bob());
