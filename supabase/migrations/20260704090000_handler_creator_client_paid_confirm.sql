-- Client "mark as paid" confirmation on paid-collab creator deals.
--
-- On the public share link's "New Paid Collab" tab, a client who is responsible
-- for paying a creator can flag that they have processed the PayPal payment.
-- This DOES NOT change `payment_status` — it is a soft confirmation that pings
-- the assigned handler (+ Bob) so they can cross-check and finalize the real
-- status from the backend.
--
-- Two additive columns, written only by the public edge function
-- `post-shared-paidcollab-paid` (service role), and surfaced read-only in the
-- handler workspace / Bob+APC brand tab / client share views.

alter table public.handler_collab_creators
  add column if not exists client_paid_confirmed_at   timestamptz,
  add column if not exists client_paid_confirmed_name text;

comment on column public.handler_collab_creators.client_paid_confirmed_at is
  'Set when the share-link client marks this creator''s payment as done (PayPal). Soft flag only — handler finalizes payment_status. Null = not confirmed.';
comment on column public.handler_collab_creators.client_paid_confirmed_name is
  'Public name of the client who marked the payment as done.';
