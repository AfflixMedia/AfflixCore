-- =========================================================
-- Afflix Core — Paid Collab handler workspace: "Terminated" status
-- Base: 20260806090000_handler_collab_follow_up.sql (payment_status CHECK).
--
-- Adds a fifth payment_status value, `terminated`, for a creator deal the
-- handler cancels. It is an INTERNAL-ONLY end-state:
--   * Only the handler's own workspace shows and sets it (inline status
--     dropdown + status groups).
--   * It is HIDDEN from every client-facing / read-only surface — the client
--     portal, the Brand Detail "view mode" Paid Collab tab, and the public
--     share link — where each read path strips terminated rows out (FE +
--     get-shared-reports edge fn), mirroring how follow_up is masked.
--
-- Behaviourally it sits alongside pending/paid: the auto-status trigger
-- (handler_collab_creators_auto_status) and the stall sweep
-- (handler_collab_apply_follow_ups) only ever touch videos_in_progress /
-- follow_up rows, so a terminated deal is never auto-flipped — no trigger or
-- sweep changes are needed, only the CHECK constraint has to allow the value.
-- =========================================================

alter table public.handler_collab_creators
  drop constraint if exists handler_collab_creators_payment_status_check;
alter table public.handler_collab_creators
  add constraint handler_collab_creators_payment_status_check
  check (payment_status in ('videos_in_progress', 'follow_up', 'pending', 'paid', 'terminated'));
