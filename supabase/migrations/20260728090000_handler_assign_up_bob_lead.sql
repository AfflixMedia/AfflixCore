-- =========================================================
-- Afflix Core — Internal Paid Collab Handlers assign tasks UPWARD
--
-- Until now an internal handler could only assign tasks to the APCs of their
-- brands (handler_can_assign, 20260718). Widen it so they can also assign
-- upward to:
--   * any Bob, and
--   * the Team Lead(s) who own one of the handler's brands.
--
-- This mirrors the APC upward-assignment pattern (20260719). No new profile
-- read access is needed — internal_handler_sees_profile() (20260718) already
-- exposes Bob + the handler's brands' APCs/Team Leads to the handler, so the
-- assignee picker can render them.
--
-- Only the "tasks handler *" insert/update WITH CHECK gate changes (both call
-- handler_can_assign(assignee_id)); the read/delete "own created" policies are
-- untouched.
-- =========================================================
create or replace function public.handler_can_assign(p_assignee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_internal_handler()
     and (
       -- upward: any Bob
       public.is_bob_user(p_assignee)
       -- an APC who holds one of the handler's brands
       or exists (
         select 1 from public.apc_brands ab
         join public.paid_collab_handler_brands hb
           on hb.brand_id = ab.brand_id and hb.handler_id = auth.uid()
         join public.profiles p on p.id = ab.apc_id and p.role = 'apc'
         where ab.apc_id = p_assignee
       )
       -- upward: a Team Lead who owns one of the handler's brands
       or exists (
         select 1 from public.team_lead_brands tb
         join public.paid_collab_handler_brands hb
           on hb.brand_id = tb.brand_id and hb.handler_id = auth.uid()
         join public.profiles p on p.id = tb.team_lead_id and p.role = 'team_lead'
         where tb.team_lead_id = p_assignee
       )
     );
$$;
grant execute on function public.handler_can_assign(uuid) to authenticated;
