-- =========================================================
-- Afflix Core - Track whether a paid creator has been paid out.
-- Once a creator's live-video count meets `agreed_videos`, the
-- UI flags them as "Payment pending" until paid_out flips true.
-- =========================================================

alter table public.paid_creators
  add column if not exists paid_out   boolean     not null default false,
  add column if not exists paid_at    timestamptz;
