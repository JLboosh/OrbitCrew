import type { WeightUnit } from './units';

/**
 * Geographic formatting and the flat projection used by the schematic gym map.
 *
 * IMPORTANT: nothing here ever handles a USER's position for storage or sharing.
 * A coordinate reaches this module only to answer "what is near this point" and
 * to place gym pins relative to it on screen. The database holds no user
 * coordinates at all — see supabase/migrations/..._presence.sql.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in metres (IUGG). */
const EARTH_RADIUS_METRES = 6_371_008.8;

export type DistanceSystem = 'metric' | 'imperial';

/**
 * Distance system inferred from the member's weight unit.
 *
 * A proxy, deliberately: the profile has no separate distance preference yet, and
 * someone logging in pounds is overwhelmingly likely to want miles. Worth
 * replacing with a real `distance_unit` column rather than extending this guess
 * to more places.
 */
export function distanceSystemForWeightUnit(unit: WeightUnit): DistanceSystem {
  return unit === 'lb' ? 'imperial' : 'metric';
}

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

/**
 * Formats a distance for a gym list or pin label.
 *
 * Precision is deliberately coarse. "480 m" is useful; "482.7 m" implies an
 * accuracy that consumer GPS does not have, and the gym coordinate itself is an
 * OpenStreetMap centroid rather than the front door.
 */
export function formatDistance(metres: number, system: DistanceSystem = 'metric'): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';

  if (system === 'imperial') {
    const miles = metres / METRES_PER_MILE;
    if (miles < 0.1) {
      return `${Math.round(metres / METRES_PER_FOOT / 10) * 10} ft`;
    }
    return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
  }

  if (metres < 1000) {
    return `${Math.round(metres / 10) * 10} m`;
  }
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Radius choices offered on the map screen, in metres. */
export const RADIUS_CHOICES = [1000, 2500, 5000, 10_000, 25_000] as const;

export function formatRadius(metres: number, system: DistanceSystem = 'metric'): string {
  return formatDistance(metres, system);
}

/**
 * Projects a point onto a unit square centred on `origin`, north up.
 *
 * Equirectangular rather than Web Mercator, and that is the correct choice here:
 * over a few kilometres the difference is imperceptible, the maths is cheap
 * enough to run on every render, and — unlike Mercator — it keeps the distance
 * rings drawn around the origin genuinely circular. Longitude is scaled by
 * cos(latitude) so east-west distance is not exaggerated away from the equator.
 *
 * Returns fractional coordinates where 0.5,0.5 is the origin and 0 or 1 is
 * `radiusMetres` away. Values may fall outside 0..1 for points beyond the
 * radius; callers clamp.
 */
export function projectToUnitSquare(
  origin: LatLng,
  point: LatLng,
  radiusMetres: number,
): { x: number; y: number } {
  const safeRadius = radiusMetres > 0 ? radiusMetres : 1;

  const latRadians = (origin.latitude * Math.PI) / 180;
  const metresPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_METRES;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(latRadians);

  const eastMetres = (point.longitude - origin.longitude) * metresPerDegreeLon;
  const northMetres = (point.latitude - origin.latitude) * metresPerDegreeLat;

  return {
    x: 0.5 + eastMetres / (2 * safeRadius),
    // Screen y grows downward, so north must be negated.
    y: 0.5 - northMetres / (2 * safeRadius),
  };
}

/**
 * Basic plausibility check for a coordinate pair.
 *
 * Distance is never computed on the client: `nearby_gyms` returns true spheroidal
 * metres from PostGIS, which is both indexed and authoritative. Recomputing it
 * here would risk showing a different number than the one used for ranking.
 */
export function isValidLatLng(value: Partial<LatLng> | null | undefined): value is LatLng {
  if (!value) return false;
  const { latitude, longitude } = value;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}
