-- =========================================================
-- Afflix Core — Super Boss manages Ads Managers' notes.
--
-- The Ads Manager Keep-style notes live in owner-scoped handler_notes.
-- Super Boss (is_superbob) gets FULL access (read/edit/delete) to notes
-- owned by ads_manager accounts — surfaced via the floating notes button
-- on the Brands pages. Regular Bobs keep their existing read-only policy
-- ("handler_notes bob read"); only Super Boss can edit, and only
-- ads_manager-owned notes (handlers' notes stay owner+bob-read only).
-- =========================================================

drop policy if exists "handler_notes superbob ads all" on public.handler_notes;
create policy "handler_notes superbob ads all" on public.handler_notes
  for all using (
    public.is_superbob() and exists (
      select 1 from public.profiles p
      where p.id = handler_notes.owner_id and p.role = 'ads_manager'
    )
  ) with check (
    public.is_superbob() and exists (
      select 1 from public.profiles p
      where p.id = handler_notes.owner_id and p.role = 'ads_manager'
    )
  );
