-- =========================================================
-- Afflix Core — Paid Collab activity log (handler workspace "Logs" tab)
--
-- Brand-scoped audit trail for handler_collab_creators: who changed a
-- creator's payment status (incl. payments sent), when a client marked a
-- payment as done, and creator add/remove. Because rows are keyed by
-- brand_id, EVERY handler assigned to the brand sees the same log —
-- including changes made by other handlers of that brand, by Bob/APC
-- (Brand Detail Performance/Authorization edits), by the client
-- (mark-paid), and by the automatic status sweep.
--
-- Design notes:
--   * creator_id / actor_id are PLAIN uuids (no FK) + name snapshots, so
--     log rows survive creator deletion and account deletion — inserting
--     FK-referencing rows during a user-delete cascade aborts the delete
--     (the 20260722 chat_membership_log lesson).
--   * brand_id keeps a real FK (cascade): logs die with the brand. The
--     DELETE branch skips logging when the brand row is already gone
--     (creator rows cascade-deleting under a brand delete).
--   * Writes happen ONLY via the AFTER trigger (SECURITY DEFINER, table
--     owner bypasses RLS) — no insert/update/delete policies at all.
--   * The automatic sweep (handler_collab_apply_follow_ups) tags its
--     changes via a transaction-local GUC so the trigger records
--     auto = true instead of blaming whoever happened to load the page.
-- =========================================================

-- ---------- 1. Table ----------
create table if not exists public.handler_collab_activity_log (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid not null references public.brands(id) on delete cascade,
  creator_id   uuid,                       -- snapshot, no FK (see header)
  creator_name text not null default '',
  month        text,                       -- creator's onboarded month (YYYY-MM) at log time
  action       text not null check (action in
                 ('creator_added','status_change','client_paid_marked','client_paid_unmarked','creator_removed')),
  old_status   text,
  new_status   text,
  auto         boolean not null default false,  -- true = automatic status sweep, not a person
  actor_id     uuid,                       -- auth.uid() snapshot, no FK
  actor_name   text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists hcal_brand_created_idx
  on public.handler_collab_activity_log (brand_id, created_at desc);

alter table public.handler_collab_activity_log enable row level security;

-- Read: Bob + every handler assigned to the brand (writes_paid_collab_brand),
-- plus internal staff with brand access (APC / Team Lead — the Brand Detail
-- Paid Collab audience). Clients are deliberately excluded.
drop policy if exists "hcal read" on public.handler_collab_activity_log;
create policy "hcal read" on public.handler_collab_activity_log
  for select to authenticated
  using (
    public.writes_paid_collab_brand(brand_id)
    or (public.is_internal_staff() and public.user_has_brand_access(brand_id))
  );

-- ---------- 2. Logging trigger ----------
create or replace function public.handler_collab_log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_name text := '';
  v_auto       boolean := coalesce(current_setting('afflix.pc_auto_sweep', true), '') = '1';
  v_brand      uuid;
  v_creator    uuid;
  v_name       text;
  v_month      text;
begin
  if tg_op = 'DELETE' then
    v_brand := old.brand_id; v_creator := old.id; v_name := old.name;
    v_month := to_char(coalesce(old.onboarded_on, old.created_at::date), 'YYYY-MM');
  else
    v_brand := new.brand_id; v_creator := new.id; v_name := new.name;
    v_month := to_char(coalesce(new.onboarded_on, new.created_at::date), 'YYYY-MM');
  end if;

  -- Actor display-name snapshot (readers' RLS may not cover the actor's profile).
  if v_actor is not null then
    select coalesce(nullif(btrim(full_name), ''), email, '') into v_actor_name
      from public.profiles where id = v_actor;
    v_actor_name := coalesce(v_actor_name, '');
  end if;

  if tg_op = 'INSERT' then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, new_status, actor_id, actor_name)
    values
      (v_brand, v_creator, v_name, v_month, 'creator_added', new.payment_status, v_actor, v_actor_name);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Brand cascade-delete: the parent brands row is already gone — skip
    -- (the log rows for this brand are being cascade-deleted anyway).
    if not exists (select 1 from public.brands where id = v_brand) then
      return old;
    end if;
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, old_status, actor_id, actor_name)
    values
      (v_brand, v_creator, v_name, v_month, 'creator_removed', old.payment_status, v_actor, v_actor_name);
    return old;
  end if;

  -- UPDATE: payment-status transition (manual or auto-sweep)
  if new.payment_status is distinct from old.payment_status then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, old_status, new_status, auto, actor_id, actor_name)
    values
      (v_brand, v_creator, v_name, v_month, 'status_change',
       old.payment_status, new.payment_status, v_auto, v_actor, v_actor_name);
  end if;

  -- UPDATE: client "mark payment as done" soft flag flipping on/off. The
  -- public share-link edge fn runs as service role (actor null) but stamps
  -- client_paid_confirmed_name — prefer that as the actor label.
  if (new.client_paid_confirmed_at is not null) <> (old.client_paid_confirmed_at is not null) then
    insert into public.handler_collab_activity_log
      (brand_id, creator_id, creator_name, month, action, actor_id, actor_name)
    values
      (v_brand, v_creator, v_name, v_month,
       case when new.client_paid_confirmed_at is not null then 'client_paid_marked' else 'client_paid_unmarked' end,
       v_actor,
       coalesce(nullif(btrim(new.client_paid_confirmed_name), ''), nullif(v_actor_name, ''), 'Client'));
  end if;

  return new;
end $$;

drop trigger if exists handler_collab_creators_log on public.handler_collab_creators;
create trigger handler_collab_creators_log
  after insert or update or delete on public.handler_collab_creators
  for each row execute function public.handler_collab_log_activity();

-- ---------- 3. Sweep re-created: tag its changes as automatic ----------
-- Base: 20260806090000_handler_collab_follow_up.sql — identical logic, plus
-- the transaction-local GUC the logging trigger reads (is_local = true, so
-- it resets when the RPC's transaction ends).
create or replace function public.handler_collab_apply_follow_ups()
returns int language plpgsql security definer set search_path = public as $$
declare
  n1 int;
  n2 int;
begin
  perform set_config('afflix.pc_auto_sweep', '1', true);

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

  perform set_config('afflix.pc_auto_sweep', '', true);
  return n1 + n2;
end $$;
revoke all on function public.handler_collab_apply_follow_ups() from public;
grant execute on function public.handler_collab_apply_follow_ups() to authenticated;
