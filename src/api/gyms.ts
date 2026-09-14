import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { isValidLatLng, type LatLng } from '@/lib/geo';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database.types';

export type GymRow = Database['public']['Tables']['gyms']['Row'];

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
