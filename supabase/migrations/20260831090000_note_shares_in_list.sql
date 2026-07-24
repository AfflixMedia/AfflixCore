-- =========================================================
-- Afflix Core — expose a note's share targets to its owner.
--
-- list_visible_notes() (from 20260830) returned each note the caller owns or is
-- shared, but NOT who the caller shared their OWN notes with. Add a `shares`
-- array to each row (populated only for notes the caller owns) so the board can
-- offer a "Shared by me" view showing each note + its recipients.
--
-- Each element: { kind, role, team, team_name } — role for kind='role',
-- team/team_name (the Team Lead) for kind='team'. Recreated in place; the
-- function stays SECURITY DEFINER + granted to authenticated.
-- =========================================================

create or replace function public.list_visible_notes()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(hn)
       || jsonb_build_object(
            'owner_role', p.role,
            'owner_is_superbob', coalesce(p.is_superbob, false),
            'owner_name', coalesce(nullif(btrim(p.full_name), ''), p.email, ''),
            'is_owner', hn.owner_id = auth.uid(),
            'shares', case when hn.owner_id = auth.uid() then (
                select coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'kind', s.target_kind,
                      'role', s.target_role,
                      'team', s.target_team,
                      'team_name', coalesce(nullif(btrim(tlp.full_name), ''), tlp.email)
                    )
                    order by s.target_kind, s.target_role
                  ),
                  '[]'::jsonb)
                from public.handler_note_shares s
                left join public.profiles tlp on tlp.id = s.target_team
                where s.note_id = hn.id
              ) else '[]'::jsonb end
          )
  from public.handler_notes hn
  join public.profiles p on p.id = hn.owner_id
  where hn.owner_id = auth.uid()
     or public.note_shared_with_caller(hn.id)
  order by hn.pinned desc, hn.updated_at desc;
$$;
grant execute on function public.list_visible_notes() to authenticated;
