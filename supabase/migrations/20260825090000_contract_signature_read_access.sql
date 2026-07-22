-- Signed creator contracts are visible in every brand-access read view.
--
-- The signing link replaced the handler's manually pasted contract_url, so the
-- signed copy is now the single source of truth: the paid-collab client, the
-- brand's APC / Team Lead / Ads Manager and Bob all need to see that a creator
-- signed (and open the read-only signed copy at /sign/<token>).
--
-- `user_has_brand_access` already backs the handler_collab_* reads, so this
-- simply aligns the signature rows with the data they belong to. Writes stay
-- restricted to Bob + the brand's assigned handler(s).

drop policy if exists "hcs staff read" on public.handler_contract_signatures;

drop policy if exists "hcs brand read" on public.handler_contract_signatures;
create policy "hcs brand read" on public.handler_contract_signatures
  for select
  using (public.user_has_brand_access(brand_id));
