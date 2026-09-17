import campusBuildings from '@/data/campusBuildings.json';
import type { LatLng } from '@/lib/geo';

/**
 * The University of Waterloo campus, and the rule for when the map switches into
 * campus mode.
 *
 * WHY A CAMPUS MODE EXISTS AT ALL
 * -------------------------------
 * Extruded buildings are only meaningful where we have surveyed footprints. We
 * have them for one place: the UW campus, generated from OpenStreetMap by
 * `scripts/fetch-campus-buildings.mjs`. Everywhere else the honest presentation
 * is a flat map with gym pins, because inventing building shapes — or extruding
 * whatever the basemap happens to include — would show the member geometry we
 * cannot vouch for.
 *
 * It is also the performance boundary. The GeoJSON source is only attached to the
 * map while the camera is actually over campus, so panning across the province
 * never asks the renderer to hold 230 extruded polygons it cannot see.
 *
 * The data is © OpenStreetMap contributors (ODbL); attribution is a licence
 * condition wherever it is drawn.
 */

export interface CampusBuildingProperties {
  name: string | null;
  /** Short code where OSM has one, e.g. "PAC". More legible on a map than the full name. */
  ref: string | null;
  building: string;
  /** Surveyed height in metres, when OSM records one. */
  height: number | null;
  levels: number | null;
  /** What the extrusion uses: surveyed height, else levels × 3.5 m, else 9 m. */
  render_height: number;
  height_is_measured: boolean;
}

export interface CampusBuildingFeature {
  type: 'Feature';
  id: string;
  properties: CampusBuildingProperties;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface CampusBuildingCollection {
  type: 'FeatureCollection';
  metadata: {
    source: string;
    licence: string;
    area: string;
    generated_by: string;
    generated_at: string;
    building_count: number;
    named_count: number;
    measured_height_count: number;
    metres_per_level: number;
    default_height_metres: number;
    bounds: { west: number; south: number; east: number; north: number };
    main_campus_bbox: number[];
  };
  features: CampusBuildingFeature[];
}

export const CAMPUS_BUILDINGS = campusBuildings as unknown as CampusBuildingCollection;

/** Tight bounds around the generated footprints, not a hand-typed guess. */
export const CAMPUS_BOUNDS = CAMPUS_BUILDINGS.metadata.bounds;

/**
 * Where the map opens.
 *
 * The centre of the building bounds rather than a memorised coordinate, so it
 * follows the data if the dataset is ever regenerated with a different extent.
 */
export const CAMPUS_CENTRE: LatLng = {
  latitude: (CAMPUS_BOUNDS.south + CAMPUS_BOUNDS.north) / 2,
  longitude: (CAMPUS_BOUNDS.west + CAMPUS_BOUNDS.east) / 2,
};

/**
 * Slack added to the bounds when deciding whether the camera is "on campus".
 *
 * Roughly 800 m. Without it, buildings would pop in and out while panning along
 * the edge of campus, and a member looking at the south end of campus with the
 * centre just off the boundary would see a flat map with campus buildings
 * visibly missing.
 */
const CAMPUS_MARGIN_DEGREES = 0.0075;

/**
 * The zoom at which extrusions turn on.
 *
 * Below this the footprints are smaller than a few pixels, so they read as grey
 * noise while still costing a full GeoJSON upload to the GPU.
 */
export const CAMPUS_MIN_ZOOM = 14.2;

/** Zoom the map opens at on campus: the whole campus fits, buildings legible. */
export const CAMPUS_DEFAULT_ZOOM = 15.4;

/** Pitch used for the campus 3D view. Enough to read height without losing the plan. */
export const CAMPUS_DEFAULT_PITCH = 55;

export function isWithinCampus(point: LatLng, marginDegrees = CAMPUS_MARGIN_DEGREES): boolean {
  return (
    point.latitude >= CAMPUS_BOUNDS.south - marginDegrees &&
    point.latitude <= CAMPUS_BOUNDS.north + marginDegrees &&
    point.longitude >= CAMPUS_BOUNDS.west - marginDegrees &&
    point.longitude <= CAMPUS_BOUNDS.east + marginDegrees
  );
}

/**
 * Whether campus 3D should be drawn for a given camera.
 *
 * Both conditions matter: `isWithinCampus` is what keeps 3D off everywhere else,
 * and the zoom floor is what keeps it off when campus is a thumbnail on screen.
 */
export function shouldRenderCampus3D(centre: LatLng, zoom: number): boolean {
  return zoom >= CAMPUS_MIN_ZOOM && isWithinCampus(centre);
}

/**
 * Label text for a building.
 *
 * Prefers the short code where OSM has one — "PAC" fits on a footprint that
 * "Physical Activities Complex" does not, and it is what people on campus
 * actually say. Falls back to the full name, and to nothing for the 58
 * unnamed footprints, which are drawn but not labelled.
 */
export function campusBuildingLabel(properties: CampusBuildingProperties): string {
  return properties.ref ?? properties.name ?? '';
}
