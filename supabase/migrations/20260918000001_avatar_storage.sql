-- ----------------------------------------------------------------------------
-- Profile pictures
-- ----------------------------------------------------------------------------
-- `profiles.avatar_url` has existed since the identity migration, but nothing
-- could ever fill it: the project shipped no storage bucket, so every avatar in
-- the app was the initial-based fallback. This adds the one bucket needed to let
-- a member upload a picture.
--
-- WHY THE BUCKET IS PUBLIC
-- ------------------------
-- `avatar_url` is a plain text column that the app stores and re-renders for as
-- long as the profile exists. A private bucket would mean signed URLs, which
-- expire — storing one in a column would produce avatars that work for an hour
-- and then break, and re-signing on every read would mean a network round trip
-- before any avatar could be drawn.
--
-- This does not widen who can see a member's picture in practice, because an
-- avatar was never private data in this schema: `gym_presence()` and
-- `find_profile_by_username()` both already return `avatar_url` to crew mates and
-- to anyone permitted to look the member up. What the public bucket does mean is
-- that the URL itself carries no access control, so object names include a random
-- component (see `useUploadAvatar`) rather than being derivable from a user id.
-- The UI says so plainly at the upload control.
--
-- Writes are per-member: the first path segment must be the caller's own user id,
-- which is what stops one account replacing another's picture.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  -- 2 MB. Generous for a profile picture and small enough that a slow connection
  -- in a gym basement still finishes.
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone. The bucket is public, so a restrictive SELECT policy here would
-- be theatre — the object is served by the storage CDN regardless.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read
  on storage.objects
  for select
  using (bucket_id = 'avatars');

/**
 * Write: only inside your own folder.
 *
 * `storage.foldername(name)` splits the object path, so `[1]` is the first
 * segment. Requiring it to equal the caller's uuid means the only object a member
 * can create, replace, or delete is one under `<their id>/`.
 */
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Delete matters: replacing a picture should not leave the old file behind
-- forever, and a member should be able to remove their picture entirely.
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
