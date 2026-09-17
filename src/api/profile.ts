import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
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
