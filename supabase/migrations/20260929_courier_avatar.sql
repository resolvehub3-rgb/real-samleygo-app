-- =====================================================================
-- Profile photos (courier rider photos, and any signed-in user's avatar)
-- + realtime delivery of profile changes to the customer & restaurant apps.
-- Run this in the Supabase SQL editor (Supabase Dashboard → SQL Editor).
-- Idempotent: safe to run multiple times.
-- =====================================================================

-- 1. PUBLIC bucket so the customer's order screen and the restaurant's
--    dispatch board can render the assigned courier's photo with a plain
--    <img src> (no signed URLs, no extra round-trips, works in realtime).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 2. Policies: a signed-in user may only ever write inside their own folder
--    (<auth.uid>/<filename>); the public may read (public bucket).
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public can view avatars" on storage.objects;
create policy "Public can view avatars" on storage.objects
  for select to public
  using (bucket_id = 'avatars');

-- 3. REALTIME: `profiles` (avatar_url / full_name / phone) was not part of the
--    supabase_realtime publication, so a courier uploading a photo would only
--    reach the customer and the restaurant on their next refetch. Adding the
--    table makes the photo appear live on both screens the moment it changes.
--    RLS already allows every user to read profiles ("Users can view all
--    public profiles"), so no new data becomes visible — only faster.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
