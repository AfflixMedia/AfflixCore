-- =========================================================
-- Afflix Core — Paid Collab: gate "Payment Pending" visibility to clients
--
-- When a handler sets a creator's payment_status = 'pending', that status must
-- stay hidden from the client-facing read views (public share link, paid collab
-- client portal, and Bob/APC's Brand Detail → Paid Collab tab) until the handler
-- explicitly flips this toggle on. While false, those read views show the
-- creator as "Videos in Progress" instead of "Payment Pending".
--
-- The handler's own workspace always shows the true status + the toggle control.
-- Writes are already gated by writes_paid_collab_brand(); reads by
-- user_has_brand_access() — no policy changes needed for the new column.
-- =========================================================

alter table public.handler_collab_creators
  add column if not exists pending_visible_to_client boolean not null default false;

comment on column public.handler_collab_creators.pending_visible_to_client is
  'Handler toggle: when payment_status = pending, the Payment Pending status is hidden from client/Bob read views until this is true.';
