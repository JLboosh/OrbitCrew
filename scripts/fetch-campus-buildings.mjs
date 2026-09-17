/**
 * Builds the University of Waterloo campus building dataset used by the 3D map.
 *
 * WHY THE DATA IS COMMITTED RATHER THAN FETCHED AT RUNTIME
 * -------------------------------------------------------
 * Same reason `ingest-osm-gyms.mjs` exists: the public Overpass API's usage
 * policy is roughly 10,000 requests/day for an ENTIRE application, not per user.
 * Querying it on map load would exhaust that and get the app blocked. Campus
 * footprints also effectively never change, so a generated asset is both cheaper
 * and more reliable than a live call — the map still renders when Overpass is
 * down.
 *
 * Buildings are selected by Overpass AREA membership in the OSM feature for the
 * university itself, not by a hand-drawn bounding box. That is what makes them
 * "campus buildings" rather than "buildings near campus", and it means the
 * definition is OpenStreetMap's rather than ours.
 *
 * Data is © OpenStreetMap contributors, ODbL. Attribution is a licence
 * condition wherever this is displayed — see GymMapView.
 *
 * Usage:
 *   node scripts/fetch-campus-buildings.mjs
 */

import { writeFileSync } from 'node:fs';

/** Tried in order, one attempt each. Retry-looping one endpoint gets you banned. */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const USER_AGENT = 'gymcrew/0.1 (campus building extrusions; contact: dev@gymcrew.app)';

const OUTPUT = new URL('../src/data/campusBuildings.json', import.meta.url);

/**
 * The campus, as OpenStreetMap defines it.
 *
 * The University of Waterloo is `relation/11680616`, a multipolygon carrying
 * `wikidata=Q1049470`. Matching on the Wikidata id rather than the name avoids
 * catching Wilfrid Laurier next door, or a street called "University Avenue".
 * Overpass derives an area from the multipolygon, and `way(area.campus)` then
 * means "inside the campus boundary" rather than "inside a box near it".
 */
const CAMPUS_QUERY = `
[out:json][timeout:180];
area["wikidata"="Q1049470"]["amenity"="university"]->.campus;
(
  way(area.campus)["building"];
);
out geom tags;
`;

/**
 * The main campus, as a bounding box: [west, south, east, north].
 *
 * The area query above is scoped by OWNERSHIP, and the University of Waterloo
 * multipolygon includes satellite properties — the Stratford School, the
 * Kitchener pharmacy campus, and outlying research land. Left unfiltered the
 * dataset spans ~50 km, which would make a "are we looking at campus?" test
 * cover half of southwestern Ontario.
 *
 * So ownership decides what counts as a campus building, and this box decides
 * which campus. It covers the main Waterloo campus from University Avenue north
 * to the research park, and Laurel Creek east to Phillip Street.
 */
const MAIN_CAMPUS_BBOX = [-80.5665, 43.4615, -80.5275, 43.4835];

function withinMainCampus(feature) {
  const [west, south, east, north] = MAIN_CAMPUS_BBOX;
  // Centroid test: a footprint straddling the edge belongs to whichever side
  // holds most of it, which avoids half-drawn buildings at the boundary.
  const ring = feature.geometry.coordinates[0];
  let lonSum = 0;
  let latSum = 0;
  for (const [lon, lat] of ring) {
    lonSum += lon;
    latSum += lat;
  }
  const lon = lonSum / ring.length;
  const lat = latSum / ring.length;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * Metres per storey, used only when a building has `building:levels` but no
 * explicit `height`. 3.5 m is a conservative figure for institutional buildings
 * with services above the ceiling; it is a rendering approximation and is
 * recorded as such rather than presented as a measurement.
 */
const METRES_PER_LEVEL = 3.5;

/** Fallback extrusion for a footprint with neither height nor level tags. */
const DEFAULT_HEIGHT_METRES = 9;

/** Coordinate precision kept in the asset. 5 dp is ~1.1 m — plenty for a map. */
const COORD_PRECISION = 5;

async function overpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      process.stdout.write(`Querying ${new URL(endpoint).host}… `);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      console.log(`ok (${json.elements?.length ?? 0} elements)`);
      return json;
    } catch (err) {
      console.log(`failed: ${err.message}`);
      lastError = err;
    }
  }
  throw lastError ?? new Error('All Overpass endpoints failed');
}

function round(value) {
  return Number(value.toFixed(COORD_PRECISION));
}

/** Parses a tag like "24" or "24 m" into metres. Returns null when unusable. */
function parseMetres(value) {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 400) return null;
  return Number(parsed.toFixed(1));
}

function parseLevels(value) {
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 120) return null;
  return parsed;
}

/**
 * Converts one Overpass way into a GeoJSON polygon feature.
 *
 * `out geom` gives an ordered node list. A building outline is expected to be
 * closed; anything with fewer than four points cannot bound an area and is
 * dropped rather than rendered as a degenerate sliver.
 */
function toFeature(element) {
  const geometry = element.geometry;
  if (!Array.isArray(geometry) || geometry.length < 4) return null;

  const ring = geometry
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .map((point) => [round(point.lon), round(point.lat)]);

  if (ring.length < 4) return null;

  // GeoJSON requires an explicitly closed ring.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

  const tags = element.tags ?? {};
  const height = parseMetres(tags.height);
  const levels = parseLevels(tags['building:levels']);

  return {
    type: 'Feature',
    id: `${element.type}/${element.id}`,
    properties: {
      name: typeof tags.name === 'string' ? tags.name : null,
      // Short name where OSM has one: "PAC" is more legible on a map than
      // "Physical Activities Complex".
      ref: typeof tags.ref === 'string' ? tags.ref : null,
      building: typeof tags.building === 'string' ? tags.building : 'yes',
      height,
      levels,
      /**
       * What the extrusion actually uses. Precomputed so the map style stays a
       * plain property read: explicit height when OSM has one, else levels
       * converted at METRES_PER_LEVEL, else a flat default.
       */
      render_height:
        height ?? (levels ? Number((levels * METRES_PER_LEVEL).toFixed(1)) : DEFAULT_HEIGHT_METRES),
      /** True only when the height comes from a surveyed tag, not an estimate. */
      height_is_measured: height !== null,
    },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

function boundsOf(features) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of features) {
    for (const [lon, lat] of feature.geometry.coordinates[0]) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }

  return {
    west: round(west),
    south: round(south),
    east: round(east),
    north: round(north),
  };
}

const response = await overpass(CAMPUS_QUERY);

const allFeatures = (response.elements ?? [])
  .filter((element) => element.type === 'way')
  .map(toFeature)
  .filter((feature) => feature !== null);

const features = allFeatures
  .filter(withinMainCampus)
  // Largest first: a smaller building drawn after a larger one that contains it
  // stays visible, and label collision resolution then favours the big ones.
  .sort((a, b) => ringArea(b) - ringArea(a));

console.log(
  `Kept ${features.length} of ${allFeatures.length} buildings inside the main campus box.`,
);

if (features.length === 0) {
  console.error('No campus buildings returned. Refusing to write an empty dataset.');
  process.exit(1);
}

const named = features.filter((feature) => feature.properties.name !== null).length;
const measured = features.filter((feature) => feature.properties.height_is_measured).length;

const collection = {
  type: 'FeatureCollection',
  /**
   * Provenance, kept in the file so nobody has to guess where it came from or
   * whether it is safe to hand-edit. It is not: re-run the script.
   */
  metadata: {
    source: 'OpenStreetMap via Overpass API',
    licence: 'ODbL — © OpenStreetMap contributors',
    area: 'University of Waterloo (OSM wikidata=Q1067164, amenity=university)',
    generated_by: 'scripts/fetch-campus-buildings.mjs',
    generated_at: new Date().toISOString(),
    building_count: features.length,
    named_count: named,
    measured_height_count: measured,
    metres_per_level: METRES_PER_LEVEL,
    default_height_metres: DEFAULT_HEIGHT_METRES,
    /** Tight box around what was actually kept. Used to decide campus mode. */
    bounds: boundsOf(features),
    /** The filter that produced it, recorded so the two cannot drift apart. */
    main_campus_bbox: MAIN_CAMPUS_BBOX,
  },
  features,
};

writeFileSync(OUTPUT, `${JSON.stringify(collection)}\n`);

console.log(`\nWrote ${features.length} campus buildings to src/data/campusBuildings.json`);
console.log(`  named: ${named}`);
console.log(`  surveyed heights: ${measured} (the rest are estimated from levels)`);
console.log(`  bounds: ${JSON.stringify(collection.metadata.bounds)}`);

/** Shoelace area in squared degrees. Only used for relative ordering. */
function ringArea(feature) {
  const ring = feature.geometry.coordinates[0];
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum / 2);
}
