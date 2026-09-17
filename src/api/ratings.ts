import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Gym = Database['public']['Tables']['gyms']['Row'];
export type GymRating = Database['public']['Tables']['gym_ratings']['Row'];

/**
 * The seven rating axes.
 *
 * Separate axes rather than one blended star score, because "good gym" means
 * different things to different people: someone training at 6pm cares about
 * crowding, someone in a hot climate cares about air conditioning.
 *
 * NOTE on `crowding`: higher is BETTER (5 = pleasantly quiet), consistent with
 * every other axis. The UI must never invert one scale relative to the others.
 */
export const RATING_AXES = [
  { key: 'overall', label: 'Overall', required: true },
  { key: 'air_conditioning', label: 'Air conditioning', required: false },
  { key: 'equipment_quality', label: 'Equipment quality', required: false },
  { key: 'equipment_availability', label: 'Equipment availability', required: false },
  { key: 'cleanliness', label: 'Cleanliness', required: false },
  { key: 'crowding', label: 'Space to train', required: false },
  { key: 'value_for_money', label: 'Value for money', required: false },
] as const;

export type RatingAxis = (typeof RATING_AXES)[number]['key'];

/**
 * A single gym.
 *
 * Nearby-gym search (`nearby_gyms`) and the map belong to the gyms/map lane and
 * are intentionally not wrapped here. This hook exists because a session, a
 * check-in, and a rating all need to display which gym they refer to.
 */
export function useGym(gymId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gym(gymId ?? 'none'),
    enabled: Boolean(gymId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Gym> => {
      const { data, error } = await supabase.from('gyms').select('*').eq('id', gymId!).single();
      if (error) throw error;
      return data;
    },
  });
}

/** Averages across all seven axes for a gym. */
export function useGymRatingSummary(gymId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gymRatingSummary(gymId ?? 'none'),
    enabled: Boolean(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_rating_summaries')
        .select('*')
        .eq('gym_id', gymId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useGymRatings(gymId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gymRatings(gymId ?? 'none'),
    enabled: Boolean(gymId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_ratings')
        .select('*')
        .eq('gym_id', gymId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** The caller's own rating for a gym, if they have one. */
export function useMyGymRating(gymId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...queryKeys.gymRatings(gymId ?? 'none'), 'mine'],
    enabled: Boolean(gymId && user?.id),
    queryFn: async (): Promise<GymRating | null> => {
      const { data, error } = await supabase
        .from('gym_ratings')
        .select('*')
        .eq('gym_id', gymId!)
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export interface RatingInput {
  gymId: string;
  overall: number;
  airConditioning?: number | null;
  equipmentQuality?: number | null;
  equipmentAvailability?: number | null;
  cleanliness?: number | null;
  crowding?: number | null;
  valueForMoney?: number | null;
  reviewText?: string | null;
}

/**
 * Submits a rating.
 *
 * A member may rate a given gym once every 30 days, enforced by a database
 * trigger rather than in the client, so the limit cannot be bypassed. The
 * rejection carries a message mentioning "30 days", which the UI surfaces
 * directly.
 */
export function useSubmitGymRating() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: RatingInput) => {
      const { data, error } = await supabase
        .from('gym_ratings')
        .insert({
          gym_id: input.gymId,
          user_id: user!.id,
          overall: input.overall,
          air_conditioning: input.airConditioning ?? null,
          equipment_quality: input.equipmentQuality ?? null,
          equipment_availability: input.equipmentAvailability ?? null,
          cleanliness: input.cleanliness ?? null,
          crowding: input.crowding ?? null,
          value_for_money: input.valueForMoney ?? null,
          review_text: input.reviewText?.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      client.invalidateQueries({ queryKey: queryKeys.gymRatings(input.gymId) });
      client.invalidateQueries({ queryKey: queryKeys.gymRatingSummary(input.gymId) });
    },
  });
}

/**
 * The subset of rating fields a member may revise.
 *
 * Derived from the generated Update type rather than hand-rolled, so
 * nullability matches the schema exactly: `overall` is NOT NULL and therefore
 * cannot be cleared, while the optional axes can.
 */
export type GymRatingPatch = Pick<
  Database['public']['Tables']['gym_ratings']['Update'],
  | 'overall'
  | 'air_conditioning'
  | 'equipment_quality'
  | 'equipment_availability'
  | 'cleanliness'
  | 'crowding'
  | 'value_for_money'
  | 'review_text'
>;

/** Revises an existing rating. Permitted at any time; only NEW ratings are limited. */
export function useUpdateGymRating() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ratingId,
      gymId,
      patch,
    }: {
      ratingId: string;
      gymId: string;
      patch: GymRatingPatch;
    }) => {
      const { error } = await supabase.from('gym_ratings').update(patch).eq('id', ratingId);
      if (error) throw error;
      return gymId;
    },
    onSuccess: (gymId) => {
      client.invalidateQueries({ queryKey: queryKeys.gymRatings(gymId) });
      client.invalidateQueries({ queryKey: queryKeys.gymRatingSummary(gymId) });
    },
  });
}

export function useReportGym() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      gymId?: string;
      ratingId?: string;
      reason: Database['public']['Enums']['report_reason'];
      detail?: string;
    }) => {
      const { error } = await supabase.from('gym_reports').insert({
        gym_id: input.gymId ?? null,
        rating_id: input.ratingId ?? null,
        reporter_id: user!.id,
        reason: input.reason,
        detail: input.detail?.trim() || null,
      });
      if (error) throw error;
    },
  });
}
