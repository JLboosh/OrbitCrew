import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import type { PickedImage } from '@/lib/imagePicker';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type PrivacySettings = Database['public']['Tables']['privacy_settings']['Row'];
export type PresenceVisibility = Database['public']['Enums']['presence_visibility'];
export type ActivityDetailLevel = Database['public']['Enums']['activity_detail_level'];

/** The signed-in member's profile. */
export function useMyProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.profile(user?.id ?? 'anonymous'),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (
      patch: Pick<
        Database['public']['Tables']['profiles']['Update'],
        'display_name' | 'username' | 'bio' | 'weight_unit' | 'timezone' | 'avatar_url'
      >,
    ) => {
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      client.setQueryData(queryKeys.profile(user!.id), data);
    },
  });
}

/**
 * The signed-in member's privacy settings.
 *
 * Guaranteed to exist: the signup trigger creates the row alongside the profile,
 * so this never has to cope with a missing record and default to something
 * ambiguous.
 */
export function useMyPrivacySettings() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.privacySettings(user?.id ?? 'anonymous'),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<PrivacySettings> => {
      const { data, error } = await supabase
        .from('privacy_settings')
        .select('*')
        .eq('user_id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export type PrivacyPatch = Pick<
  Database['public']['Tables']['privacy_settings']['Update'],
  | 'presence_visibility'
  | 'default_activity_detail'
  | 'share_progress_summary'
  | 'discoverable_by_username'
  | 'allow_motivation_spotlight'
  | 'contribute_to_crowd_stats'
>;

/**
 * Updates privacy settings with an optimistic write.
 *
 * Optimistic here specifically because a privacy toggle must feel immediate:
 * a switch that lags makes members doubt whether the change took effect. The
 * previous value is restored if the request fails, so the UI never claims a
 * protection that was not actually applied.
 */
export function useUpdatePrivacySettings() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (patch: PrivacyPatch) => {
      const { data, error } = await supabase
        .from('privacy_settings')
        .update(patch)
        .eq('user_id', user!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    onMutate: async (patch) => {
      const key = queryKeys.privacySettings(user!.id);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<PrivacySettings>(key);
      if (previous) {
        client.setQueryData<PrivacySettings>(key, { ...previous, ...patch });
      }
      return { previous };
    },

    onError: (_error, _patch, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.privacySettings(user!.id), context.previous);
      }
    },

    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.privacySettings(user!.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Profile picture
// ---------------------------------------------------------------------------

/** Created by `20260918000001_avatar_storage.sql`. Public read, per-member write. */
const AVATAR_BUCKET = 'avatars';

/** Mirrors the bucket's own limits, so a rejection is explained before the upload. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Uploads a new profile picture and points the profile at it.
 *
 * ORDER MATTERS. The file is uploaded first and `avatar_url` is written second, so
 * a failure never leaves the profile pointing at an object that does not exist. The
 * cost of that order is an orphaned file if the profile update fails, which is
 * invisible to everyone; the opposite order would show every friend a broken
 * image.
 *
 * OBJECT NAMES CARRY A RANDOM COMPONENT. The bucket is public, so the URL is the
 * only thing standing between a stranger and the image. `<user id>/avatar.jpg`
 * would be guessable from a user id, which `find_profile_by_username` hands out;
 * `<user id>/<random>.jpg` is not. The folder still has to be the member's own id,
 * because that is what the storage policy checks.
 *
 * The previous picture is deleted afterwards, on a best-effort basis: the new one
 * is already live by then, so a failed cleanup costs a stray file rather than a
 * broken avatar.
 */
export function useUploadAvatar() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (picked: PickedImage): Promise<Profile> => {
      if (!ALLOWED_AVATAR_TYPES.includes(picked.mimeType)) {
        throw new Error('Pictures need to be a JPEG, PNG, or WebP.');
      }
      if (picked.sizeBytes > MAX_AVATAR_BYTES) {
        throw new Error('That picture is over 2 MB. Pick a smaller one.');
      }

      const userId = user!.id;
      const extension = EXTENSION_BY_TYPE[picked.mimeType] ?? 'jpg';
      const objectPath = `${userId}/${randomToken()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(objectPath, picked.file, { contentType: picked.mimeType, upsert: false });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);

      const previous = await readCurrentAvatarUrl(userId);

      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId)
        .select()
        .single();
      if (error) {
        // Roll the upload back rather than leaving a file nothing references.
        await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
        throw error;
      }

      await removeAvatarObject(previous);
      return data;
    },
    onSuccess: (profile) => {
      // Written straight into the cache, so the sidebar and every avatar update
      // without a refetch.
      client.setQueryData(queryKeys.profile(profile.id), profile);
    },
  });
}

/** Clears the profile picture, falling back to the initial-based avatar. */
export function useRemoveAvatar() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<Profile> => {
      const userId = user!.id;
      const previous = await readCurrentAvatarUrl(userId);

      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;

      await removeAvatarObject(previous);
      return data;
    },
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.profile(profile.id), profile);
    },
  });
}

async function readCurrentAvatarUrl(userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('avatar_url').eq('id', userId).single();
  return data?.avatar_url ?? null;
}

/**
 * Deletes a previously uploaded avatar, given the public URL stored on the profile.
 *
 * Only touches URLs that are actually objects in our own bucket. A profile could
 * carry an avatar_url from somewhere else entirely (a seeded row, or a future
 * OAuth provider), and trying to "clean up" a URL we do not own would be both
 * pointless and wrong.
 */
async function removeAvatarObject(publicUrl: string | null): Promise<void> {
  const objectPath = avatarObjectPath(publicUrl);
  if (!objectPath) return;
  await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
}

/** The in-bucket path for one of our public URLs, or null if it is not ours. */
export function avatarObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  const path = publicUrl.slice(index + marker.length).split('?')[0];
  return path && path.length > 0 ? decodeURIComponent(path) : null;
}

/**
 * Short random object-name component.
 *
 * `crypto.getRandomValues` where available, falling back to `Math.random` — this
 * is a collision guard and an unguessability measure for a profile picture, not a
 * secret, and the fallback keeps the upload working on any runtime.
 */
function randomToken(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) {
    const bytes = new Uint8Array(12);
    cryptoRef.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
