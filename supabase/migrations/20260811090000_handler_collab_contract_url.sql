-- Signed contract link on paid-collab deals.
-- Workflow: the handler downloads the filled agreement PDF (Contract column),
-- sends it to the creator (e.g. via Google Drive), and once the creator signs
-- pastes the signed copy's link here. Shown as a link icon in the Contract
-- column; editable in the creator editor modal.
-- No RLS changes: reads ride user_has_brand_access, writes ride
-- writes_paid_collab_brand (bob + assigned handler) on handler_collab_creators.

alter table public.handler_collab_creators
  add column if not exists contract_url text;
