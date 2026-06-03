-- =========================================================
-- Afflix Core — Paid Collab video ad code authorization
-- Flags whether a video's ad code has been authorized.
-- =========================================================

alter table public.paid_creator_videos
  add column if not exists ad_code_authorized boolean not null default false;
