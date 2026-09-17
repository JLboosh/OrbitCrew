import type { StyleSpecification } from 'maplibre-gl';

import type { ColorScheme } from '@/theme/colors';

/**
 * The basemap style, authored here rather than fetched from a style server.
 *
 * WHY WE WRITE OUR OWN STYLE
 * --------------------------
 * Off-the-shelf styles are designed to be a general-purpose street map: bright,
 * busy, and full of retail POIs. This map has one job — show where gyms are and
 * who is at them — so anything that competes with a green marker is noise. Owning
 * the style means the basemap is guaranteed to stay a quiet backdrop, in the
 * app's own palette, in both light and dark mode.
 *
 * It also removes a runtime dependency: a style URL is a network fetch that can
 * fail or silently change under us. Only the tiles are remote.
 *
 * TILES AND FONTS: OpenFreeMap
 * ----------------------------
 * https://openfreemap.org — OpenMapTiles-schema vector tiles with no API key, no
 * account, and no request cap. That matters here because the app deliberately
 * ships no map credentials: `EXPO_PUBLIC_*` variables are inlined into the
 * bundle, so a keyed provider would mean publishing the key.
 *
 * Tiles are © OpenStreetMap contributors (ODbL). The attribution string below is
 * a licence condition, not decoration, and MapLibre renders it permanently.
 */

const OPENMAPTILES_SOURCE = 'openmaptiles';
const TILE_URL = 'https://tiles.openfreemap.org/planet';
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const MAP_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · tiles by <a href="https://openfreemap.org">OpenFreeMap</a>';

/** Source id for the committed campus footprints. */
export const CAMPUS_SOURCE_ID = 'campus-buildings';
/** Layer ids, exported so the map component can toggle them without string drift. */
export const CAMPUS_FILL_LAYER_ID = 'campus-buildings-3d';
export const CAMPUS_LABEL_LAYER_ID = 'campus-buildings-label';

const FONT_REGULAR = ['Noto Sans Regular'];
const FONT_BOLD = ['Noto Sans Bold'];

/**
 * Builds the style for the current colour scheme.
 *
 * Layer set is deliberately minimal: land, water, parks, roads, and a small
 * number of labels. No POIs, no building footprints outside campus, no transit —
 * every one of those would put unrelated icons next to gym markers.
 */
export function basemapStyle(colors: ColorScheme, isDark: boolean): StyleSpecification {
  // Derived once so the two modes stay recognisably the same map rather than two
  // different designs. Land is a shade off the app canvas so the map reads as a
  // distinct surface inside a card.
  const land = isDark ? '#0C1210' : '#E8ECE6';
  const water = isDark ? '#0A1418' : '#D3DFE4';
  const park = isDark ? '#101A13' : '#DFE8DC';
  const roadMinor = isDark ? '#1B241E' : '#F4F6F2';
  const roadMajor = isDark ? '#26312A' : '#FFFFFF';
  const roadCasing = isDark ? '#0A0F0C' : '#DCE3DD';

  // Campus buildings are muted grey by requirement: they are context, and the
  // only saturated thing on this map should be a gym.
  const buildingFill = isDark ? '#3A423C' : '#B9C2BB';
  const buildingTop = isDark ? '#48524A' : '#CBD3CC';

  return {
    version: 8,
    name: 'gymcrew quiet',
    glyphs: GLYPHS_URL,
    sources: {
      [OPENMAPTILES_SOURCE]: {
        type: 'vector',
        url: TILE_URL,
        attribution: MAP_ATTRIBUTION,
      },
      [CAMPUS_SOURCE_ID]: {
        type: 'geojson',
        /**
         * Starts EMPTY on purpose.
         *
         * The campus footprints are a committed asset, so there is no request to
         * fail — but handing 230 polygons to the renderer while the member is
         * looking at another city is work with nothing to show for it. The map
         * component calls `setData` when the camera enters campus and clears it
         * again on the way out, which is what keeps the 3D cost scoped to the one
         * place the data describes.
         */
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    // A slight exaggeration reads as depth without making tall buildings look
    // like towers. Applies only where extrusions exist, i.e. campus.
    light: { anchor: 'viewport', intensity: isDark ? 0.2 : 0.45 },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': land } },

      {
        id: 'water',
        type: 'fill',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': water },
      },

      {
        id: 'park',
        type: 'fill',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'park',
        paint: { 'fill-color': park, 'fill-opacity': 0.7 },
      },

      {
        id: 'landuse-campus',
        type: 'fill',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['university', 'school', 'hospital'], true, false],
        paint: { 'fill-color': isDark ? '#111A14' : '#E1E8DD', 'fill-opacity': 0.8 },
      },

      // Footpaths matter on a campus: they are how you actually get to the PAC.
      {
        id: 'path',
        type: 'line',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
        minzoom: 14,
        paint: {
          'line-color': isDark ? '#212B24' : '#EDF0EA',
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 2.5],
        },
      },

      {
        id: 'road-minor',
        type: 'line',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['minor', 'service'], true, false],
        minzoom: 12,
        paint: {
          'line-color': roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 18, 6],
        },
      },

      {
        id: 'road-major-casing',
        type: 'line',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'transportation',
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
          true,
          false,
        ],
        paint: {
          'line-color': roadCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 18, 14],
        },
      },

      {
        id: 'road-major',
        type: 'line',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'transportation',
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
          true,
          false,
        ],
        paint: {
          'line-color': roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 18, 10],
        },
      },

      // ----------------------------------------------------------------------
      // Campus buildings.
      //
      // Present in the style from the start but starting hidden, so switching
      // campus mode on and off is a visibility toggle rather than an add/remove
      // of layers and a source. Toggling visibility cannot fail halfway and
      // leave the map in a broken state.
      // ----------------------------------------------------------------------
      {
        id: CAMPUS_FILL_LAYER_ID,
        type: 'fill-extrusion',
        source: CAMPUS_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'render_height'],
            0,
            buildingFill,
            40,
            buildingTop,
          ],
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': 0,
          // Slightly translucent so a gym marker behind a building is still
          // findable rather than fully occluded.
          'fill-extrusion-opacity': 0.92,
          // Fades the extrusion in with zoom, so crossing the campus threshold
          // is a transition rather than a pop.
          'fill-extrusion-vertical-gradient': true,
        },
      },

      {
        id: 'road-label',
        type: 'symbol',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_REGULAR,
          'text-size': 11,
          'symbol-placement': 'line',
        },
        paint: {
          'text-color': colors.textSubtle,
          'text-halo-color': land,
          'text-halo-width': 1.2,
        },
      },

      {
        id: 'place-label',
        type: 'symbol',
        source: OPENMAPTILES_SOURCE,
        'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 14, 15],
          // Campus labels and gym markers own the detail zooms.
          'text-max-width': 8,
        },
        maxzoom: 14,
        paint: {
          'text-color': colors.textMuted,
          'text-halo-color': land,
          'text-halo-width': 1.5,
        },
      },

      // Building labels sit above the extrusions and below the gym markers,
      // which are DOM elements and therefore always on top.
      {
        id: CAMPUS_LABEL_LAYER_ID,
        type: 'symbol',
        source: CAMPUS_SOURCE_ID,
        layout: {
          visibility: 'none',
          // Blank for the unnamed footprints; MapLibre draws nothing for those.
          'text-field': ['coalesce', ['get', 'ref'], ['get', 'name'], ''],
          'text-font': FONT_BOLD,
          'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 14],
          'text-max-width': 9,
          'text-padding': 4,
          // Keeps a label with its building rather than letting it drift to a
          // clear patch of map, which on a dense campus means the wrong building.
          'text-variable-anchor': ['center', 'top', 'bottom'],
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': isDark ? '#DCE5DC' : '#33403A',
          'text-halo-color': isDark ? '#0B120E' : '#F2F5F0',
          'text-halo-width': 1.6,
        },
      },
    ],
  };
}
