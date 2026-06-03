-- =========================================================
-- Afflix Core - Manual control over the "Payment pending" popup.
--
-- Default behavior stays automatic (computed from live video count vs
-- agreed_videos + paid_out). Bob and Paid Collab Handlers can override
-- visibility at three levels — brand, program, creator. The most-specific
-- non-'auto' value wins:
--      creator override > program default > brand default > automatic
-- =========================================================

-- 1. Brand-level default.
alter table public.brands
  add column if not exists payment_popup_default text not null default 'auto'
  check (payment_popup_default in ('auto','force_hide','force_show'));

-- 2. Program-level default.
alter table public.paid_creator_programs
  add column if not exists payment_popup_default text not null default 'auto'
  check (payment_popup_default in ('auto','force_hide','force_show'));

-- 3. Creator-level override.
alter table public.paid_creators
  add column if not exists payment_popup_override text not null default 'auto'
  check (payment_popup_override in ('auto','force_hide','force_show'));
