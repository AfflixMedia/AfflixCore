-- =========================================================
-- Afflix Core - Optional PayPal email for paying out creators.
-- Shown to clients on payment-pending creator cards so they
-- know where to send the payout.
-- =========================================================

alter table public.paid_creators
  add column if not exists paypal_email text;
