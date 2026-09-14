import { Card, Screen, Text } from '@/components/ui';

/**
 * ==========================================================================
 * PLACEHOLDER — OWNED BY THE GYMS/MAP LANE
 * ==========================================================================
 * Not implemented by the foundation work. Everything the database side needs is
 * already built, applied, and verified against the real project.
 *
 * WHAT TO BUILD
 *   * Map with nearby gym pins
 *   * Gym pin callout: name, distance, rating summary, friend visits, live presence
 *   * Navigation to the gym detail screen at /gym/[id]
 *
 * FREE STACK (no paid API keys anywhere)
 *   * @maplibre/maplibre-react-native for the map view
 *   * OpenFreeMap for vector tiles: https://tiles.openfreemap.org/styles/liberty
 *     No API key, no registration, no request limits.
 *   * NOTE: MapLibre is a native module, so Expo Go will NOT work. A development
 *     build is required (npx expo prebuild, then run on a simulator/device).
 *   * Attribution is REQUIRED: "© OpenStreetMap contributors" must be visible.
 *
 * READY-MADE DATABASE CONTRACT
 *   supabase.rpc('nearby_gyms', {
 *     p_latitude, p_longitude, p_radius_metres, p_limit
 *   })
 *     -> { id, name, latitude, longitude, address, opening_hours, distance_metres }
 *     Ordered nearest first. Radius is metres on the WGS84 spheroid. The limit is
 *     clamped server-side to 200.
 *
 *   supabase.rpc('gym_presence', { p_gym_id })
 *     -> members currently checked in WHO HAVE OPTED IN and whom the caller is
 *        permitted to see. Already filtered; render whatever it returns.
 *
 *   supabase.rpc('gym_friend_visits', { p_gym_id })
 *     -> { visitor_count, named_visitors }
 *        `visitor_count` includes everyone; `named_visitors` contains only those
 *        who share gym-level detail. Show the count and name only the named ones.
 *
 * IMPORTANT: gyms are cached in our own table on purpose. Do NOT call Overpass
 * from the app — its usage policy is ~10k requests/day for the WHOLE app, and
 * per-pan queries would get us blocked. Import in bulk with
 * `npm run gyms:import -- waterloo` instead.
 *
 * PRIVACY RULES THAT MUST HOLD IN THE UI
 *   * Never render a marker at a USER's position. Presence is gym-level only;
 *     the database stores no user coordinates at all.
 *   * Do not add a heat map, breadcrumb trail, or any movement history.
 *   * Use the caller's location transiently for the nearby query; never persist it.
 *
 * Add hooks as src/api/gyms.ts, following the patterns in src/api/ratings.ts.
 */
export default function MapScreen() {
  return (
    <Screen title="Map" subtitle="Find gyms near you.">
      <Card>
        <Text variant="subheading">Not built yet</Text>
        <Text variant="caption" tone="muted">
          This screen belongs to the gyms and map workstream. The database side is ready: 26 gyms
          are already imported, and nearby search, gym presence, and friend-visit counts all work.
        </Text>
      </Card>
      <Card>
        <Text variant="caption" tone="subtle">
          See the comment block at the top of app/(tabs)/map.tsx for the full contract, the free
          tile source, and the privacy rules that apply here.
        </Text>
      </Card>
    </Screen>
  );
}
