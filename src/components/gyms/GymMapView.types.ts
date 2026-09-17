import type { GymPresenceByGymId, NearbyGym } from '@/api';
import type { DistanceSystem, LatLng } from '@/lib/geo';

/**
 * The map's props, shared by both implementations.
 *
 * There are two: `GymMapView.web.tsx` is a real MapLibre map with a 3D campus
 * mode, and `GymMapView.tsx` is the schematic radar plot used on native, where
 * MapLibre is a native module that Expo Go cannot load. Metro resolves the `.web`
 * variant automatically.
 *
 * The interface lives in its own file so the two cannot drift apart: adding a
 * prop to one without the other is a type error rather than a runtime surprise on
 * whichever platform you were not testing. Props the schematic cannot honour are
 * marked below and ignored there — never silently dropped from the type.
 */
export interface GymMapViewProps {
  /**
   * Where the map opens, and the point distances are measured from.
   *
   * On web this seeds the INITIAL camera only; afterwards the member owns the
   * camera. Held in state and never persisted — the schema has no column for a
   * user's position.
   */
  origin: LatLng;
  /** Nearest-first, as returned by `nearby_gyms`. */
  gyms: NearbyGym[];
  radiusMetres: number;
  selectedGymId?: string | null;
  onSelectGym: (gym: NearbyGym) => void;
  distanceSystem?: DistanceSystem;
  /**
   * Live presence per gym id, for avatars on markers. Already filtered
   * server-side to members who opted in and whom the caller may see.
   *
   * Web only: the schematic plot's pins are 30px numbered circles with no room
   * for an avatar stack, and it lists presence in the detail card instead.
   */
  presenceByGymId?: GymPresenceByGymId;
  /** True when `origin` is the member's device location rather than a fallback. */
  hasDeviceLocation?: boolean;
  /**
   * Fires after the camera settles. Lets the screen refetch gyms for wherever the
   * member panned to.
   *
   * Web only: the schematic has no camera to move.
   */
  onCentreChange?: (centre: LatLng) => void;
  /** Height in pixels. Web only; the schematic is square by construction. */
  height?: number;

  /**
   * Turns the map into a location picker for adding a gym.
   *
   * Both implementations honour this, which is what makes "drop a pin" work
   * without a native map module: on web it is a click on a real MapLibre map, and
   * on native it is a tap on the schematic plot, whose projection is exact and
   * therefore invertible. The pin is a PLACE, not a person — the rule that no
   * marker is ever drawn at a user's position is unaffected.
   */
  pinMode?: boolean;
  /** The currently chosen point, drawn distinctly from the gym markers. */
  pinLocation?: LatLng | null;
  /** Fires when the member picks a point. Only called while `pinMode` is set. */
  onPickLocation?: (point: LatLng) => void;
}
