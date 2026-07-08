-- =========================================================
-- Afflix Core — Super Boss shares notes with Ads Managers.
--
-- handler_notes gains `shared_with_ads`: when a Super Boss flips it on
-- one of HIS OWN notes, every ads_manager can READ that note (it shows
-- up read-only in their floating notes drawer / Notes page). Writes stay
-- owner-only (+ the existing Super Boss policy over ads_manager notes),
-- so ads managers can never edit or delete a shared boss note.
-- =========================================================

alter table public.handler_notes
  add column if not exists shared_with_ads boolean not null default false;

-- Ads Managers read notes a Super Boss shared with them. Owner must be a
-- Super Boss so a handler/APC flipping the flag on their own note (they
-- can — owner policy is all-columns) still exposes nothing.
drop policy if exists "handler_notes ads read shared" on public.handler_notes;
create policy "handler_notes ads read shared" on public.handler_notes
  for select using (
    public.is_ads_manager()
    and shared_with_ads
    and exists (
      select 1 from public.profiles p
      where p.id = handler_notes.owner_id
        and p.role = 'bob' and p.is_superbob
    )
  );
