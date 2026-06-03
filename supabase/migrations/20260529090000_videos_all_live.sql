-- =========================================================
-- Afflix Core — Paid Collab: videos are always "live"
-- A video only exists once it is posted, so every video counts as
-- live. "Pipeline" is now derived from a creator's agreed_videos
-- minus the videos actually added. Normalise legacy rows.
-- =========================================================

update public.paid_creator_videos
  set status = 'live'
  where status is distinct from 'live';
