-- =========================================================
-- Afflix Core — Global Chat: WhatsApp-style read receipts (ticks)
--
-- Adds per-member DELIVERY tracking alongside the existing per-member READ
-- tracking (chat_participants.last_read_at). From these two timestamps the
-- front-end derives tick state for each message a user sends:
--   • single tick  — message stored on the server (sender's insert succeeded)
--   • double tick   — delivered: every recipient's last_delivered_at >= msg time
--   • blue double   — read:      every recipient's last_read_at      >= msg time
-- Per-person breakdown (who received / read / pending) is computed client-side
-- from the same columns — no per-message receipt rows needed.
-- =========================================================

-- ---------- Delivery column ----------
-- Nullable (= unknown / not yet delivered). Bumped to now() whenever a member's
-- client is alive and receives conversation activity (see chat_mark_delivered).
alter table public.chat_participants
  add column if not exists last_delivered_at timestamptz;

-- ---------- RPC: mark everything the caller can see as "delivered to me" ----------
-- Called on app load and whenever a realtime message arrives. Bumps the caller's
-- own participant rows to now() so the SENDER sees a double tick once recipients
-- are online. Also tracks delivery on the announcement channel even before the
-- caller first opens it (lazy row created with an epoch last_read_at so it still
-- counts as UNREAD until they actually open and read it).
create or replace function public.chat_mark_delivered()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;

  update public.chat_participants
     set last_delivered_at = now()
   where user_id = auth.uid()
     and (last_delivered_at is null or last_delivered_at < now());

  -- Announcement: record delivery for online staff who haven't opened it yet.
  -- Insert keeps last_read_at in the past so the unread badge/divider survive;
  -- a real open (markConversationRead) advances last_read_at later.
  if public.is_internal_staff() then
    insert into public.chat_participants (conversation_id, user_id, last_read_at, last_delivered_at)
    select c.id, auth.uid(), '-infinity'::timestamptz, now()
    from public.chat_conversations c
    where c.is_announcement = true
    on conflict (conversation_id, user_id)
      do update set last_delivered_at = now();
  end if;
end;
$$;
revoke all on function public.chat_mark_delivered() from public;
grant execute on function public.chat_mark_delivered() to authenticated;
