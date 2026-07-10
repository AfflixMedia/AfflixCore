-- =========================================================
-- Afflix Core — Paid Collab handler workspace: "Follow-up Required" status
-- (applies to the shared handler_collab_creators table, so BOTH internal and
-- external handlers get it, plus every read view of the same rows).
--
-- Status flow (payment_status):
--   follow_up           — creator has ZERO posted videos (needs a follow-up),
--                         or was "Videos in Progress" but the posted-video
--                         count hasn't increased for 1 week.
--   videos_in_progress  — auto-entered the moment the FIRST video lands
--                         (0 → 1 posted videos while in follow_up).
--   pending             — all agreed videos posted (existing FE rule, now also
--                         swept server-side and reachable from follow_up).
--   paid                — manual, unchanged.
--
-- Mechanics:
--   * video_count_updated_at — stamped by trigger whenever the posted-video
--     count INCREASES (also reset on a manual switch back to
--     videos_in_progress, so a manual reset restarts the 1-week timer).
--   * handler_collab_creators_auto_status trigger — enforces the
--     zero-videos→follow_up and first-video→videos_in_progress rules on
--     every insert/update (writes come from the handler UI, addCreator, and
--     the video-auth RPC — auth flips don't change the count, so no-op there).
--   * handler_collab_apply_follow_ups() — SECURITY DEFINER sweep called from
--     the front-end on workspace/tab load (same pattern as
--     fire_due_note_reminders): flips stalled in-progress creators (no new
--     video for 7 days, not complete) to follow_up, and advances any row
--     whose videos are all posted to pending.
-- =========================================================

-- ---------- 1. Allow the new status value ----------
alter table public.handler_collab_creators
  drop constraint if exists handler_collab_creators_payment_status_check;
alter table public.handler_collab_creators
  add constraint handler_collab_creators_payment_status_check
  check (payment_status in ('videos_in_progress', 'follow_up', 'pending', 'paid'));

-- ---------- 2. Stall timer column ----------
-- Existing rows get now() (fresh 1-week window) — avoids mass-flipping every
-- long-standing in-progress creator to follow_up the moment this ships.
alter table public.handler_collab_creators
  add column if not exists video_count_updated_at timestamptz not null default now();

-- ---------- 3. Posted-video counter ----------
-- "Posted" = a video_codes row whose video link is non-blank (mirrors the FE's
-- filled-count: rows are padded to videos_count with video:'' placeholders).
create or replace function public.handler_collab_posted_videos(codes jsonb)
returns int language sql immutable as $$
  select count(*)::int
  from jsonb_array_elements(coalesce(codes, '[]'::jsonb)) v
  where btrim(coalesce(v->>'video', '')) <> '';
$$;

-- ---------- 4. Auto-status trigger ----------
create or replace function public.handler_collab_creators_auto_status()
returns trigger language plpgsql as $$
declare
  new_cnt int := public.handler_collab_posted_videos(new.video_codes);
  old_cnt int;
begin
  if tg_op = 'INSERT' then
    new.video_count_updated_at := now();
    if new_cnt = 0 and new.payment_status = 'videos_in_progress' then
      new.payment_status := 'follow_up';
    end if;
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

  -- zero posted videos can never sit at "Videos in Progress"
  if new_cnt = 0 and new.payment_status = 'videos_in_progress' then
    new.payment_status := 'follow_up';
  end if;
  return new;
end $$;

drop trigger if exists handler_collab_creators_auto_status on public.handler_collab_creators;
create trigger handler_collab_creators_auto_status
  before insert or update on public.handler_collab_creators
  for each row execute function public.handler_collab_creators_auto_status();

-- ---------- 5. Stall sweep (called from the FE on load) ----------
-- Complete = every array row has a video AND at least the agreed count is
-- posted (arrays can be shorter than videos_count on legacy rows).
create or replace function public.handler_collab_apply_follow_ups()
returns int language plpgsql security definer set search_path = public as $$
declare
  n1 int;
  n2 int;
begin
  -- all videos posted → Payment Pending (mirrors the FE persist() rule)
  update public.handler_collab_creators
     set payment_status = 'pending',
         completed_on = coalesce(completed_on, current_date)
   where payment_status in ('videos_in_progress', 'follow_up')
     and jsonb_array_length(video_codes) > 0
     and public.handler_collab_posted_videos(video_codes) = jsonb_array_length(video_codes)
     and public.handler_collab_posted_videos(video_codes) >= greatest(videos_count, 1);
  get diagnostics n1 = row_count;

  -- in progress but no new video for 1 week → Follow-up Required
  update public.handler_collab_creators
     set payment_status = 'follow_up'
   where payment_status = 'videos_in_progress'
     and coalesce(video_count_updated_at, created_at) < now() - interval '7 days';
  get diagnostics n2 = row_count;

  return n1 + n2;
end $$;
revoke all on function public.handler_collab_apply_follow_ups() from public;
grant execute on function public.handler_collab_apply_follow_ups() to authenticated;

-- ---------- 6. Backfill ----------
-- Existing zero-video in-progress creators start at follow_up (the trigger
-- would do this too, but be explicit). Timer already backfilled to now() by
-- the column default in step 2.
update public.handler_collab_creators
   set payment_status = 'follow_up'
 where payment_status = 'videos_in_progress'
   and public.handler_collab_posted_videos(video_codes) = 0;
