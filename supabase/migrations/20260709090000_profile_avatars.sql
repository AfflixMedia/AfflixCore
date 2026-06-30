-- =========================================================
-- Afflix Core — Profile photos (avatars)
--
-- Users can set a profile photo from their Profile page. The image is shown
-- across the system as a circular avatar (Bob's APC/Team Lead/Handler/Client
-- lists, the Topbar/Sidebar, and Global Chat).
--
-- 1. profiles.avatar_url — public URL of the uploaded image (nullable).
-- 2. A public-read 'avatars' Storage bucket; each user may write only inside
--    their own uid-prefixed folder (path = "<uid>/<file>").
-- 3. chat_list_contacts() re-created to return avatar_url so DMs/contacts/
--    groups/mention pickers can render the photo (RLS-safe SECURITY DEFINER).
-- =========================================================

-- ---------- 1. Column ----------
alter table public.profiles add column if not exists avatar_url text;

-- ---------- 2. Storage bucket + policies ----------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Public read (the bucket is public; an explicit policy keeps the API consistent).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

-- A signed-in user may upload/replace/remove files only within their own folder,
-- i.e. the first path segment must equal their auth uid.
drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- 3. chat_list_contacts (+ avatar_url) ----------
-- Reproduced from 20260627090000 (handlers excluded); the only change is the
-- added avatar_url column. Adding a column changes the function's return type,
-- which create-or-replace can't do — drop the old signature first (a function is
-- just stored code, so this touches no data).
drop function if exists public.chat_list_contacts();
create or replace function public.chat_list_contacts()
returns table (id uuid, full_name text, email text, role text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.avatar_url
  from public.profiles p
  where p.role in ('bob', 'team_lead', 'apc')
    and p.id <> auth.uid()
    and public.is_internal_staff();
$$;
revoke all on function public.chat_list_contacts() from public;
grant execute on function public.chat_list_contacts() to authenticated;
