-- =====================================================================
-- Restaurant media: public storage bucket for logos & cover photos
-- Run this in the Supabase SQL editor (Supabase Dashboard → SQL Editor).
-- Idempotent: safe to run multiple times.
-- =====================================================================

-- 1. Create a PUBLIC bucket so customers can view restaurant photos
--    without signed URLs (homepage/explore cards use plain <img src>).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-media', 'restaurant-media', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 2. Policies: any signed-in restaurant owner may upload inside their own
--    folder (<auth.uid>/<filename>); the public may read (public bucket).
drop policy if exists "Restaurant owners can upload their own media" on storage.objects;
create policy "Restaurant owners can upload their own media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'restaurant-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Restaurant owners can replace their own media" on storage.objects;
create policy "Restaurant owners can replace their own media" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'restaurant-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Restaurant owners can delete their own media" on storage.objects;
create policy "Restaurant owners can delete their own media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'restaurant-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Public can view restaurant media" on storage.objects;
create policy "Public can view restaurant media" on storage.objects
  for select to public
  using (bucket_id = 'restaurant-media');
