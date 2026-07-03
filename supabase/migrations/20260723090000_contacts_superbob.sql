-- =========================================================
-- Afflix Core — chat_list_contacts gains is_superbob
--
-- The chat UI labels the 'bob' role "Boss"; the Super Bob account should
-- show as "Super Boss" (DM header, conversation list, contact / forward /
-- group / mention pickers). Return type changes, so drop + recreate.
-- Body otherwise identical to 20260717090000.
-- =========================================================

drop function if exists public.chat_list_contacts();

create function public.chat_list_contacts()
returns table (id uuid, full_name text, email text, role text, avatar_url text, is_superbob boolean)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.avatar_url, coalesce(p.is_superbob, false)
  from public.profiles p
  where public.is_chat_staff(p.id)
    and p.id <> auth.uid()
    and public.is_internal_staff();
$$;

grant execute on function public.chat_list_contacts() to authenticated;
