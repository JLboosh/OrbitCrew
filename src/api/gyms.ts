import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { isValidLatLng, type LatLng } from '@/lib/geo';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database, Json, SimilarGymRow } from '@/types/database';

export type GymRow = Database['public']['Tables']['gyms']['Row'];
export type { SimilarGymRow };

/**
 * Gym discovery, live presence, and friend history.
 *
 * WHERE GYM DATA COMES FROM
 * -------------------------
 * Gyms are imported from OpenStreetMap into our own GIST-indexed table and
 * queried through PostGIS. The app never talks to Overpass: its usage policy is
 * roughly 10k requests/day for the ENTIRE application, so per-pan queries would
 * exhaust the budget and get the app blocked. Bulk import instead, with
 * `npm run gyms:import -- <area>`.
 *
 * Attribution is a licence condition, not a nicety: any screen showing this data
 * must display "© OpenStreetMap contributors".
 *
 * PRIVACY
 * -------
 * The caller's coordinate is a transient query argument. It is sent to
 * `nearby_gyms`, used to rank PLACES, and never stored — the schema has no column
 * anywhere for a user's position.
 */

/**
 * A gym as returned by `nearby_gyms`.
 *
 * Declared locally rather than taken from the generated RPC return type, because
 * `supabase gen types` loses nullability on set-returning functions and would
 * claim `address` is always present. Same reason `leaderboard.ts` declares its
 * own row type.
 */
export interface NearbyGym {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  opening_hours: string | null;
  distance_metres: number;
}

/**
 * Gyms near a coordinate, nearest first.
 *
 * The server clamps `limit` to 200 and orders by true spheroidal distance, so
 * there is no client-side sorting or filtering to keep in sync.
 */
export function useNearbyGyms(origin: LatLng | null | undefined, radiusMetres = 5000, limit = 50) {
  // Narrowed once here so the query function needs no non-null assertions and an
  // implausible coordinate can never reach the database.
  const valid = isValidLatLng(origin) ? origin : null;
  const latitude = valid?.latitude ?? 0;
  const longitude = valid?.longitude ?? 0;

  return useQuery({
    queryKey: queryKeys.nearbyGyms(latitude, longitude, radiusMetres),
    enabled: valid !== null,
    // Gym locations are effectively static, so this survives tab switches.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<NearbyGym[]> => {
      const { data, error } = await supabase.rpc('nearby_gyms', {
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_metres: radiusMetres,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as NearbyGym[];
    },
  });
}

/**
 * Free-text gym lookup by name or city.
 *
 * Exists because the map needs a usable path when device location is
 * unavailable. Note it returns no coordinates: the `gyms.location` column is
 * PostGIS geography, which PostgREST serialises as opaque WKB, and only
 * `nearby_gyms` projects it to latitude/longitude. Results are therefore for
 * browsing and navigating to a gym page, not for plotting.
 */
export function useGymSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: queryKeys.gymSearch(trimmed.toLowerCase()),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<GymRow[]> => {
      const pattern = `%${escapeForFilter(trimmed)}%`;

      const { data, error } = await supabase
        .from('gyms')
        .select('*')
        .or(`name.ilike.${pattern},city.ilike.${pattern}`)
        .is('hidden_at', null)
        .order('name')
        .limit(25);
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Strips characters that are structural in PostgREST's filter grammar.
 *
 * A comma would split `or()` into extra conditions and parentheses would open a
 * new group, so an unsanitised query is both a correctness and an injection
 * concern. Wildcards are removed too, so a member typing "%" searches for a
 * literal name rather than matching every gym.
 */
function escapeForFilter(value: string): string {
  return value.replace(/[,()%*\\"']/g, ' ').trim();
}

export interface GymPresenceMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  since: string;
}

/**
 * Members checked in at a gym right now.
 *
 * Already filtered server-side to people who opted into presence sharing AND whom
 * the caller is permitted to see, with expired rows excluded. Render exactly what
 * comes back: there is no additional client-side privacy decision to make, and
 * adding one would risk diverging from the RLS policy.
 */
export function useGymPresence(gymId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gymPresence(gymId ?? 'none'),
    enabled: Boolean(gymId),
    // Short: this is the one genuinely real-time thing on the screen. Realtime
    // subscriptions are not wired up yet, so a brief staleTime stands in.
    staleTime: 30_000,
    queryFn: async (): Promise<GymPresenceMember[]> => {
      const { data, error } = await supabase.rpc('gym_presence', { p_gym_id: gymId! });
      if (error) throw error;
      return (data ?? []) as GymPresenceMember[];
    },
  });
}

export interface NamedVisitor {
  userId: string;
  displayName: string;
}

export interface GymFriendVisits {
  /** Everyone who trained here, including members who are not named. */
  visitorCount: number;
  /** Only members whose sharing level is at least 'gym_name'. */
  namedVisitors: NamedVisitor[];
}

/**
 * How many friends and crew mates have trained at a gym.
 *
 * The count and the names are deliberately separate. Someone sharing only
 * "trained" contributes to the count but is never named, so the aggregate cannot
 * be used to work around their setting. Show "4 have trained here" alongside the
 * names you were given, never "4: Alex, Sam" when only two were returned.
 */
export function useGymFriendVisits(gymId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gymFriendVisits(gymId ?? 'none'),
    enabled: Boolean(gymId),
    queryFn: async (): Promise<GymFriendVisits> => {
      const { data, error } = await supabase
        .rpc('gym_friend_visits', { p_gym_id: gymId! })
        .maybeSingle();
      if (error) throw error;

      return {
        visitorCount: Number(data?.visitor_count ?? 0),
        namedVisitors: parseNamedVisitors(data?.named_visitors),
      };
    },
  });
}

/** The RPC hands back JSONB, so the shape is checked rather than trusted. */
function parseNamedVisitors(value: Json | null | undefined): NamedVisitor[] {
  if (!Array.isArray(value)) return [];

  const visitors: NamedVisitor[] = [];
  for (const entry of value) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as { [key: string]: Json | undefined };
    const userId = record.user_id;
    const displayName = record.display_name;
    if (typeof userId === 'string' && typeof displayName === 'string') {
      visitors.push({ userId, displayName });
    }
  }
  return visitors;
}

export interface MyGymVisitPattern {
  /** The caller's finished sessions at this gym. */
  visitCount: number;
  lastVisitedAt: string | null;
  /** Sessions per hour-of-day bucket, index 0-23, in the device's timezone. */
  byHour: number[];
  /** Busiest hour for this member at this gym, or null when there is no history. */
  usualHour: number | null;
}

/**
 * The CALLER'S OWN visit pattern at a gym.
 *
 * This is not a community crowd forecast, and the UI must not present it as one.
 * A shared "usually busy Tue 5-7 PM" signal needs aggregated check-in volume from
 * members who set `privacy_settings.contribute_to_crowd_stats`, which requires a
 * new security-definer function — `sessions` is own-rows-only under RLS, exactly
 * as it should be. Until that exists, the honest thing to show is the member
 * their own habit, which needs no one else's data.
 */
export function useMyGymVisitPattern(gymId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.gymMyVisits(gymId ?? 'none'),
    enabled: Boolean(gymId && user?.id),
    queryFn: async (): Promise<MyGymVisitPattern> => {
      const { data, error } = await supabase
        .from('sessions')
        .select('started_at')
        .eq('gym_id', gymId!)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = data ?? [];
      const byHour = new Array<number>(24).fill(0);

      for (const row of rows) {
        const hour = new Date(row.started_at).getHours();
        if (hour >= 0 && hour < 24) {
          byHour[hour] = (byHour[hour] ?? 0) + 1;
        }
      }

      let usualHour: number | null = null;
      let best = 0;
      for (let hour = 0; hour < 24; hour += 1) {
        const count = byHour[hour] ?? 0;
        if (count > best) {
          best = count;
          usualHour = hour;
        }
      }

      return {
        visitCount: rows.length,
        lastVisitedAt: rows[0]?.started_at ?? null,
        byHour,
        usualHour,
      };
    },
  });
}

export type GymPresenceByGymId = Record<string, GymPresenceMember[]>;

/**
 * Live presence for MANY gyms at once, for drawing avatars on map markers.
 *
 * WHY THIS IS TWO STEPS RATHER THAN ONE QUERY PER GYM
 * --------------------------------------------------
 * `gym_presence()` answers for a single gym, and calling it for 50 map pins would
 * be 50 round trips to learn that 48 of them are empty — presence is off by
 * default, so almost every gym has nobody in it.
 *
 * So: one cheap query against the `presence` table finds which gyms have anyone
 * visible, then `gym_presence()` is called only for those. In practice that is
 * one query plus zero or one more.
 *
 * The first query is safe to run from the client because `presence_select_permitted`
 * already restricts rows to non-expired check-ins by members the caller may see —
 * the same rule the RPC applies. It selects only `gym_id`: names and avatars come
 * from the RPC, which is security-definer and therefore the vetted path for
 * profile fields.
 *
 * Per-gym results reuse `queryKeys.gymPresence(id)`, so a gym the member then
 * selects is served from cache instead of refetched by SelectedGymCard.
 */
export function useGymPresenceByGymId(gymIds: string[]) {
  // Sorted and joined so the key is stable regardless of gym ordering, and a pan
  // that returns the same gyms in a different order is a cache hit.
  const key = [...gymIds].sort().join(',');

  const occupied = useQuery({
    queryKey: queryKeys.gymsWithPresence(key),
    enabled: gymIds.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('presence').select('gym_id').in('gym_id', gymIds);
      if (error) throw error;

      return Array.from(new Set((data ?? []).map((row) => row.gym_id)));
    },
  });

  const occupiedIds = occupied.data ?? [];

  const details = useQueries({
    queries: occupiedIds.map((gymId) => ({
      queryKey: queryKeys.gymPresence(gymId),
      staleTime: 30_000,
      queryFn: async (): Promise<GymPresenceMember[]> => {
        const { data, error } = await supabase.rpc('gym_presence', { p_gym_id: gymId });
        if (error) throw error;
        return (data ?? []) as GymPresenceMember[];
      },
    })),
    combine: (results): GymPresenceByGymId => {
      const map: GymPresenceByGymId = {};
      results.forEach((result, index) => {
        const gymId = occupiedIds[index];
        // A member may have checked out between the two queries, which is normal
        // rather than an error: an empty list simply means no avatar.
        if (gymId && result.data && result.data.length > 0) map[gymId] = result.data;
      });
      return map;
    },
  });

  return { data: details, isLoading: occupied.isLoading };
}

// ---------------------------------------------------------------------------
// Member-submitted gyms
// ---------------------------------------------------------------------------

export interface DuplicateCheckInput {
  name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
}

/**
 * Possible duplicates for a gym the member is about to add.
 *
 * WHY THE CHECK RUNS BEFORE THE WRITE AND NOT ONLY INSIDE IT
 * ---------------------------------------------------------
 * `create_user_gym` also refuses a probable duplicate, so the database is what
 * actually guarantees the directory stays clean. But a refusal is a dead end: the
 * member has typed a name, dropped a pin, and gets told no. Asking first turns that
 * into a choice — "GoodLife Fitness is already here, 40 m away. Open it, or add
 * yours anyway?" — which is both a better outcome and the outcome that actually
 * prevents duplicates, because most people take the existing gym.
 *
 * Debounced by the caller through `enabled`, not here: whether the name is
 * complete enough to check is a UI judgement.
 */
export function useSimilarGyms(input: DuplicateCheckInput | null) {
  const { user } = useAuth();

  const ready =
    input !== null &&
    input.name.trim().length >= 2 &&
    isValidLatLng({ latitude: input.latitude, longitude: input.longitude });

  return useQuery({
    queryKey: queryKeys.similarGyms(
      ready ? input.name.trim().toLowerCase() : '',
      ready ? input.latitude : 0,
      ready ? input.longitude : 0,
    ),
    enabled: ready && Boolean(user?.id),
    staleTime: 60_000,
    queryFn: async (): Promise<SimilarGymRow[]> => {
      const { data, error } = await supabase.rpc('find_similar_gyms', {
        p_name: input!.name.trim(),
        p_latitude: input!.latitude,
        p_longitude: input!.longitude,
        p_address: input!.address?.trim() || undefined,
        p_limit: 5,
      });
      if (error) throw error;
      return (data ?? []) as SimilarGymRow[];
    },
  });
}

export interface CreateGymInput {
  name: string;
  latitude: number;
  longitude: number;
  address?: string | null;
  city?: string | null;
  countryCode?: string | null;
  description?: string | null;
  website?: string | null;
  /** Absolute http(s) link to a photo. */
  imageUrl?: string | null;
  /**
   * Set only after the member has been shown a possible duplicate and chosen to
   * continue. The server refuses otherwise, so this cannot be skipped by a UI that
   * forgets to ask.
   */
  confirmPossibleDuplicate?: boolean;
}

/**
 * Adds a gym to the shared directory.
 *
 * Goes through the `create_user_gym` RPC rather than an INSERT because
 * `public.gyms` has no INSERT policy, by design: it is a directory every member
 * reads, so a client-side write would let one account vandalise it for everyone.
 * The function forces `source = 'user'`, records who submitted it, validates every
 * field, rate-limits submissions, and refuses duplicates.
 *
 * The gym is a normal gym the moment this returns — the same row type, visible to
 * `nearby_gyms`, rateable, check-in-able, and usable as a session's gym — because
 * it IS a normal row in the same table. Nothing downstream distinguishes it except
 * the `source` column, which the UI shows as provenance.
 */
export function useCreateGym() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateGymInput): Promise<string> => {
      const { data, error } = await supabase.rpc('create_user_gym', {
        p_name: input.name.trim(),
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_address: input.address?.trim() || undefined,
        p_city: input.city?.trim() || undefined,
        p_country_code: input.countryCode?.trim() || undefined,
        p_description: input.description?.trim() || undefined,
        p_website: input.website?.trim() || undefined,
        p_image_url: input.imageUrl?.trim() || undefined,
        p_confirm_possible_duplicate: input.confirmPossibleDuplicate ?? false,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Every cached radius and origin is now potentially wrong, so the whole
      // gyms namespace goes rather than one key. Cheap: the results are static
      // enough that a refetch is a single indexed query.
      client.invalidateQueries({ queryKey: ['gyms'] });
    },
  });
}
