-- =========================================================
-- Afflix Core — Paid Collab video ad code
-- Adds an optional ad-code field to creator videos so the team
-- can store + copy the TikTok ad code alongside the video URL.
-- =========================================================

alter table public.paid_creator_videos
  add column if not exists ad_code text;
