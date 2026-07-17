-- ============================================================
-- Follow-up grace period for NEW creators
-- ============================================================
-- Base: 20260806090000_handler_collab_follow_up.sql
--
-- Change (user call, 2026-07-17): a newly added creator with zero posted
-- videos no longer starts at "Follow-up Required" — they start at
-- "Videos in Progress" and get the same 7-day window as everyone else
-- (video_count_updated_at is stamped on insert, so the existing
-- handler_collab_apply_follow_ups() sweep flips them to follow_up only
-- once a week passes with no posted video).
--
-- Concretely, the auto-status trigger drops both zero-video coercions:
--   * INSERT no longer forces zero-video rows to follow_up, and
--   * the trailing "zero posted videos can never sit at Videos in
--     Progress" UPDATE check is gone too — otherwise any edit to the
--     creator (amount, payout, products…) inside their first week would
--     flip them to follow_up early.
-- Everything else is unchanged: first video (0 → 1) still pulls a
-- follow_up creator back into progress, a manual switch back to
-- "Videos in Progress" still restarts the 7-day timer, the sweep and
-- pending/paid handling are untouched.

-- ---------- 1. Auto-status trigger (re-created) ----------
create or replace function public.handler_collab_creators_auto_status()
returns trigger language plpgsql as $$
declare
  new_cnt int := public.handler_collab_posted_videos(new.video_codes);
  old_cnt int;
begin
  if tg_op = 'INSERT' then
    -- Grace period: new creators start at whatever status the insert says
    -- (default "Videos in Progress") even with zero videos; the stamp below
    -- starts their 7-day window for the stall sweep.
    new.video_count_updated_at := now();
    return new;
  end if;

  old_cnt := public.handler_collab_posted_videos(old.video_codes);
  if new_cnt > old_cnt then
    new.video_count_updated_at := now();
    -- first video landing pulls a follow-up creator back into progress
    -- (an explicit status in the same update — e.g. the FE's all-complete
    --  → pending advance — wins, hence the follow_up check on NEW)
    if old_cnt = 0 and new.payment_status = 'follow_up' then
      new.payment_status := 'videos_in_progress';
    end if;
  elsif new.payment_status = 'videos_in_progress'
    and old.payment_status is distinct from 'videos_in_progress' then
    -- manual switch back to "Videos in Progress" restarts the stall timer
    new.video_count_updated_at := now();
  end if;

  return new;
end $$;

-- (trigger binding from 20260806090000 is unchanged — same function name)

-- ---------- 2. Backfill ----------
-- Zero-video creators the OLD rule flipped to follow_up at insert who are
-- still inside their first week get their grace period back; older ones
-- stay follow_up (their week is already up).
update public.handler_collab_creators
   set payment_status = 'videos_in_progress'
 where payment_status = 'follow_up'
   and public.handler_collab_posted_videos(video_codes) = 0
   and coalesce(video_count_updated_at, created_at) >= now() - interval '7 days';
