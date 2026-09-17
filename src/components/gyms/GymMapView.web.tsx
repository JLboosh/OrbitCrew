import { Ionicons } from '@expo/vector-icons';
import type { FeatureCollection } from 'geojson';
// Named imports: maplibre-gl v6 is ESM-only and has no default export.
import { MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pressable, StyleSheet, View } from 'react-native';

import type { GymMapViewProps } from './GymMapView.types';

import type { GymPresenceMember, NearbyGym } from '@/api';
import { Text } from '@/components/ui';
import {
  CAMPUS_BUILDINGS,
  CAMPUS_CENTRE,
  CAMPUS_DEFAULT_PITCH,
  CAMPUS_DEFAULT_ZOOM,
  isWithinCampus,
  shouldRenderCampus3D,
} from '@/lib/campus';
import { formatDistance, type DistanceSystem } from '@/lib/geo';
import {
  basemapStyle,
  CAMPUS_FILL_LAYER_ID,
  CAMPUS_LABEL_LAYER_ID,
  CAMPUS_SOURCE_ID,
} from '@/lib/mapStyle';
import { avatarColor, readableTextOn, useTheme } from '@/theme';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * The web gym map: a real, interactive MapLibre map.
 *
 * TWO MODES, ONE MAP
 * ------------------
 * On the University of Waterloo campus the map tilts into a 3D view and draws
 * surveyed building footprints as muted grey extrusions with labels, so a member
 * can see that the PAC is the long building next to the Student Life Centre.
 * Everywhere else it stays a flat map with the same green gym pins.
 *
 * The split is not cosmetic. We have real footprints for exactly one place — the
 * committed dataset in `src/data/campusBuildings.json`, generated from
 * OpenStreetMap — so campus is the only area where extrusions would be showing
 * the member something true. Off campus the buildings are simply absent from the
 * data, and no amount of tilting conjures them: rotating an off-campus view gives
 * an oblique flat map, never generic boxes. See `src/lib/campus.ts`.
 *
 * PRIVACY RULES CARRIED OVER FROM THE SCHEMATIC MAP
 * ------------------------------------------------
 *   * No marker is ever drawn at another USER's position. Friend avatars are
 *     anchored to a GYM's marker, which is the only location the presence table
 *     records.
 *   * The member's own dot is drawn from a coordinate held in component state and
 *     never persisted, and only when they have granted location.
 *   * The presence lists arrive already filtered server-side to people who opted
 *     in and whom the caller may see. Nothing is decided here.
 *
 * ATTRIBUTION is a licence condition, not decoration: MapLibre renders the
 * OpenStreetMap credit from the style's `attribution` field, and the campus
 * footprints carry the same licence.
 */

/** Marker sizes. The selected pin grows rather than changing colour alone. */
const PIN_SIZE = 30;
const PIN_SIZE_SELECTED = 38;

/**
 * Tell MapLibre where its worker lives.
 *
 * REQUIRED UNDER METRO, AND THE MAP IS BLANK WITHOUT IT.
 *
 * MapLibre normally locates its own worker with
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`, and bails out to an
 * empty string unless `import.meta.url` is an http URL. Metro rewrites modules
 * and does not provide one, so the library ends up calling `new Worker('')`, the
 * browser resolves that to the current document, and the dev server returns
 * index.html — "Failed to load module script: non-JavaScript MIME type". The map
 * then draws a blank canvas forever: no tile is ever parsed, `load` never fires,
 * and no error surfaces on the page.
 *
 * The file is published to `public/` by `scripts/copy-maplibre-worker.mjs`, which
 * runs on `postinstall` and before `npm start` / `npm run web`.
 *
 * Called at module scope: it is a one-line config write, and it must happen before
 * any Map is constructed.
 */
setWorkerUrl('/maplibre/maplibre-gl-worker.js');

export function GymMapView({
  origin,
  gyms,
  radiusMetres,
  selectedGymId,
  onSelectGym,
  distanceSystem = 'metric',
  presenceByGymId,
  hasDeviceLocation = false,
  onCentreChange,
  height = 460,
  pinMode = false,
  pinLocation = null,
  onPickLocation,
}: GymMapViewProps) {
  const theme = useTheme();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  /** Marker DOM nodes, keyed by gym id, so markers are React-rendered via portals. */
  const [markerNodes, setMarkerNodes] = useState<Record<string, HTMLElement>>({});
  const markersRef = useRef<Record<string, Marker>>({});

  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [campusMode, setCampusMode] = useState(() => isWithinCampus(origin));
  const [ready, setReady] = useState(false);
  /**
   * First fatal map error, if any.
   *
   * MapLibre reports style, tile, and worker failures through an `error` event
   * rather than by throwing, so without this a broken map is a silently blank
   * rectangle — which is exactly how the worker misconfiguration presented.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Latest callbacks, so the map's event listeners never call a stale closure.
   *
   * Written in an effect rather than during render: the map listeners are
   * registered once on mount and read `.current` when an event fires, which is
   * always after commit.
   */
  const onSelectGymRef = useRef(onSelectGym);
  const onCentreChangeRef = useRef(onCentreChange);
  const onPickLocationRef = useRef(onPickLocation);
  const pinModeRef = useRef(pinMode);

  useEffect(() => {
    onSelectGymRef.current = onSelectGym;
    onCentreChangeRef.current = onCentreChange;
    onPickLocationRef.current = onPickLocation;
    pinModeRef.current = pinMode;
  }, [onSelectGym, onCentreChange, onPickLocation, pinMode]);

  // ---------------------------------------------------------------------------
  // Map lifecycle. Created once; the style is swapped when the colour scheme
  // changes rather than the whole map being torn down.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const startsOnCampus = isWithinCampus(origin);

    const map = new MapLibreMap({
      container,
      style: basemapStyle(theme.colors, theme.isDark),
      center: [origin.longitude, origin.latitude],
      zoom: startsOnCampus ? CAMPUS_DEFAULT_ZOOM : zoomForRadius(radiusMetres),
      // Opening already tilted on campus means the 3D view is visible without the
      // member having to discover that the map can be tilted at all.
      pitch: startsOnCampus ? CAMPUS_DEFAULT_PITCH : 0,
      bearing: 0,
      maxPitch: 75,
      // Attribution is rendered by MapLibre from the style; it must stay visible.
      attributionControl: { compact: true },
      // Rotation and pitch are explicitly wanted at every location.
      dragRotate: true,
      pitchWithRotate: true,
      // Keeps the whole world from wrapping into view at low zoom, which makes
      // "where am I" much harder to answer.
      renderWorldCopies: true,
    });

    map.touchZoomRotate.enableRotation();
    map.keyboard.enable();

    mapRef.current = map;

    const syncCamera = () => {
      setBearing(map.getBearing());
      setPitch(map.getPitch());
      const centre = map.getCenter();
      setCampusMode(
        shouldRenderCampus3D({ latitude: centre.lat, longitude: centre.lng }, map.getZoom()),
      );
    };

    const handleMoveEnd = () => {
      syncCamera();
      const centre = map.getCenter();
      onCentreChangeRef.current?.({ latitude: centre.lat, longitude: centre.lng });
    };

    map.on('load', () => {
      setReady(true);
      syncCamera();
    });

    map.on('error', (event) => {
      const message = event.error?.message ?? 'Unknown map error';
      // Logged as well as shown: a tile 404 is worth seeing in the console even
      // when the map is otherwise usable.
      console.error('[map]', message);
      setLoadError((current) => current ?? message);
    });
    // `move` rather than `moveend` for the camera readout, so the reset control
    // appears the moment the map is rotated rather than when it stops.
    map.on('move', syncCamera);
    map.on('moveend', handleMoveEnd);
    map.on('zoomend', syncCamera);

    // Pin placement. Registered once and gated on a ref rather than re-registered
    // whenever `pinMode` flips: adding and removing a listener on a live map is
    // how you end up with two of them.
    map.on('click', (event) => {
      if (!pinModeRef.current) return;
      onPickLocationRef.current?.({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    });

    return () => {
      Object.values(markersRef.current).forEach((marker) => marker.remove());
      markersRef.current = {};
      setMarkerNodes({});
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Deliberately mount-only. `origin`/`radiusMetres` seed the first camera and
    // must not re-run this, or the map would jump while the member is panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Colour scheme changes rebuild the style. Markers are DOM elements owned by
  // MapLibre's marker layer, not the style, so they survive this.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(basemapStyle(theme.colors, theme.isDark));
  }, [theme.colors, theme.isDark, ready]);

  // ---------------------------------------------------------------------------
  // Campus 3D: attach the footprints only while the camera is over campus.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const apply = () => {
      const source = map.getSource(CAMPUS_SOURCE_ID);
      if (!source || !('setData' in source)) return;

      if (campusMode) {
        (source as GeoJSONSource).setData(CAMPUS_BUILDINGS as unknown as FeatureCollection);
      } else {
        // Emptied rather than left in place: off campus there is nothing to draw,
        // and an idle 230-polygon source is pure overhead.
        (source as GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: [],
        });
      }

      const visibility = campusMode ? 'visible' : 'none';
      for (const layerId of [CAMPUS_FILL_LAYER_ID, CAMPUS_LABEL_LAYER_ID]) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibility);
      }
    };

    // `setStyle` clears sources asynchronously, so re-apply once the new style is
    // live as well as immediately.
    if (map.isStyleLoaded()) apply();
    map.once('styledata', apply);
  }, [campusMode, ready, theme.isDark]);

  // ---------------------------------------------------------------------------
  // Markers. One per gym, positioned by MapLibre; contents rendered by React
  // through a portal so they can use the app's own components and theme.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const existing = markersRef.current;
    const wanted = new Set(gyms.map((gym) => gym.id));
    let changed = false;

    for (const [gymId, marker] of Object.entries(existing)) {
      if (!wanted.has(gymId)) {
        marker.remove();
        delete existing[gymId];
        changed = true;
      }
    }

    for (const gym of gyms) {
      const current = existing[gym.id];
      if (current) {
        current.setLngLat([gym.longitude, gym.latitude]);
        continue;
      }

      const element = document.createElement('div');
      // The pin itself handles pointer events; the wrapper must not swallow drags
      // on the map around it.
      element.style.cursor = 'pointer';

      const marker = new Marker({
        element,
        anchor: 'bottom',
        // Upright and unskewed however far the map is rotated or tilted, which is
        // what keeps a tilted campus view readable.
        rotationAlignment: 'viewport',
        pitchAlignment: 'viewport',
      })
        .setLngLat([gym.longitude, gym.latitude])
        .addTo(map);

      existing[gym.id] = marker;
      changed = true;
    }

    if (changed) {
      setMarkerNodes(
        Object.fromEntries(
          Object.entries(existing).map(([gymId, marker]) => [gymId, marker.getElement()]),
        ),
      );
    }
  }, [gyms, ready]);

  // The member's own position, when they granted it. A plain dot, never stored
  // and never shown to anyone else.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !hasDeviceLocation) return;

    const element = document.createElement('div');
    element.setAttribute('aria-hidden', 'true');
    element.style.width = '14px';
    element.style.height = '14px';
    element.style.borderRadius = '50%';
    element.style.backgroundColor = theme.colors.accent;
    element.style.border = `2px solid ${theme.colors.surface}`;
    element.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';

    const marker = new Marker({ element, pitchAlignment: 'map' })
      .setLngLat([origin.longitude, origin.latitude])
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [
    hasDeviceLocation,
    origin.latitude,
    origin.longitude,
    ready,
    theme.colors.accent,
    theme.colors.surface,
  ]);

  // The candidate location for a new gym. Coral and ringed, so it reads as "not a
  // gym yet" rather than as one more green pin among the existing ones.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !pinLocation) return;

    const element = document.createElement('div');
    element.setAttribute('aria-hidden', 'true');
    element.style.width = '22px';
    element.style.height = '22px';
    element.style.borderRadius = '50%';
    element.style.backgroundColor = theme.colors.accent;
    element.style.border = `3px solid ${theme.colors.surface}`;
    element.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';

    const marker = new Marker({ element, anchor: 'center' })
      .setLngLat([pinLocation.longitude, pinLocation.latitude])
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [pinLocation, ready, theme.colors.accent, theme.colors.surface]);

  // A crosshair cursor is the only affordance telling a member the map is now a
  // picker rather than a map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = pinMode ? 'crosshair' : '';
  }, [pinMode, ready]);

  const resetNorth = useCallback(() => {
    // Bearing AND pitch: "north" on a tilted map is still not the overhead view
    // the control promises.
    mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 450 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: 250 });
  }, []);

  const showCampus = useCallback(() => {
    mapRef.current?.easeTo({
      center: [CAMPUS_CENTRE.longitude, CAMPUS_CENTRE.latitude],
      zoom: CAMPUS_DEFAULT_ZOOM,
      pitch: CAMPUS_DEFAULT_PITCH,
      bearing: 0,
      duration: 900,
    });
  }, []);

  const isRotated = Math.abs(bearing) > 0.5 || pitch > 0.5;

  const gymNoun = gyms.length === 1 ? 'gym' : 'gyms';
  const summaryLabel = pinMode
    ? `Interactive map in pin-placement mode. Click anywhere to set the new gym's location. ${gyms.length} existing ${gymNoun} shown for reference.`
    : campusMode
      ? `Interactive 3D map of the University of Waterloo campus showing ${gyms.length} ${gymNoun}. Drag to pan, right-drag to rotate and tilt, scroll to zoom.`
      : `Interactive map showing ${gyms.length} ${gymNoun} nearby. Drag to pan, right-drag to rotate and tilt, scroll to zoom.`;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        accessibilityRole="summary"
        accessibilityLabel={summaryLabel}
        style={[
          styles.frame,
          {
            height,
            borderRadius: theme.radius.lg,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceMuted,
          },
        ]}
      >
        {/* Plain div rather than a View: MapLibre needs a real DOM container, and
            this file only ever runs on web. */}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

        {Object.entries(markerNodes).map(([gymId, node]) => {
          const gym = gyms.find((candidate) => candidate.id === gymId);
          if (!gym) return null;
          return createPortal(
            <GymMarker
              gym={gym}
              selected={gym.id === selectedGymId}
              presence={presenceByGymId?.[gym.id] ?? []}
              distanceSystem={distanceSystem}
              onPress={() => onSelectGymRef.current(gym)}
            />,
            node,
            gymId,
          );
        })}

        {/* Camera controls. Overlaid rather than MapLibre's own so they carry the
            app's styling and hit targets. */}
        <View style={[styles.controls, { top: theme.spacing.sm, right: theme.spacing.sm }]}>
          <MapControl icon="+" label="Zoom in" onPress={() => zoomBy(1)} />
          <MapControl icon="−" label="Zoom out" onPress={() => zoomBy(-1)} />
          <ResetNorthControl bearing={bearing} active={isRotated} onPress={resetNorth} />
        </View>

        {/* Mode badge. Says which of the two behaviours is active, so a flat map
            off campus reads as intended rather than as buildings failing to load.

            Top-left: the controls own the top-right and MapLibre's attribution
            owns the bottom-right, and at phone widths a bottom-left badge
            overlapped the attribution — which must stay legible. */}
        <View
          style={[styles.badge, { top: theme.spacing.sm, left: theme.spacing.sm, maxWidth: '68%' }]}
        >
          <View
            style={{
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.pill,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              paddingHorizontal: theme.spacing.sm + 2,
              paddingVertical: 5,
            }}
          >
            <Text variant="caption" tone={pinMode ? 'accent' : campusMode ? 'primary' : 'muted'}>
              {pinMode
                ? 'Click to place your gym'
                : campusMode
                  ? '3D campus · University of Waterloo'
                  : 'Nearby gyms'}
            </Text>
          </View>

          {!campusMode && !pinMode ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show the University of Waterloo campus in 3D"
              onPress={showCampus}
              style={({ pressed }) => ({
                backgroundColor: theme.colors.primary,
                borderRadius: theme.radius.pill,
                paddingHorizontal: theme.spacing.sm + 2,
                paddingVertical: 5,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text variant="caption" tone="onPrimary" style={{ fontWeight: '600' }}>
                Go to campus
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {loadError && !ready ? (
        <Text variant="caption" tone="danger">
          The map could not load ({loadError}). Gyms are still listed below.
        </Text>
      ) : null}

      <Text variant="caption" tone="subtle">
        {pinMode ? 'Click the map to set the location. ' : ''}
        Drag to pan, scroll to zoom, right-drag (or two fingers) to rotate and tilt.
        {campusMode
          ? ' Campus buildings are OpenStreetMap footprints; heights are estimated from floor counts where not surveyed.'
          : ' 3D buildings are only drawn on the University of Waterloo campus, where we have surveyed footprints.'}
      </Text>
    </View>
  );
}

/**
 * A gym pin, plus the avatars of anyone checked in.
 *
 * Avatars sit BESIDE the pin rather than on top of it, so the pin stays a
 * consistent target size and the gym remains identifiable when four people are
 * there. They are initial-based, matching every other avatar in the app — the
 * `Avatar` component deliberately loads no images so a list never flashes
 * placeholders, and a marker is the last place that would be acceptable.
 */
function GymMarker({
  gym,
  selected,
  presence,
  distanceSystem,
  onPress,
}: {
  gym: NearbyGym;
  selected: boolean;
  presence: GymPresenceMember[];
  distanceSystem: DistanceSystem;
  onPress: () => void;
}) {
  const theme = useTheme();
  const size = selected ? PIN_SIZE_SELECTED : PIN_SIZE;
  const distance = formatDistance(gym.distance_metres, distanceSystem);

  const presenceLabel =
    presence.length === 0
      ? ''
      : `. ${presence.map((member) => member.display_name).join(', ')} checked in now`;

  return (
    <View style={styles.markerRow}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${gym.name}, ${distance} away${presenceLabel}`}
        style={({ pressed }) => [
          styles.pin,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: theme.colors.primary,
            borderColor: selected ? theme.colors.textOnPrimary : theme.colors.surface,
            borderWidth: selected ? 3 : 2,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        {/* A barbell rather than a generic dot: at this size the shape is what
            distinguishes a gym from every other thing a map puts a circle on.
            Portals keep React context, so the icon font and theme resolve here
            exactly as anywhere else in the app. */}
        <Ionicons name="barbell" size={selected ? 20 : 16} color={theme.colors.textOnPrimary} />
      </Pressable>

      {presence.length > 0 ? (
        <View style={styles.presenceStack}>
          {presence.slice(0, 3).map((member, index) => (
            <MarkerAvatar key={member.user_id} member={member} overlap={index > 0} />
          ))}
          {presence.length > 3 ? (
            <View
              style={[
                styles.overflow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.primary,
                },
              ]}
            >
              <Text variant="caption" tone="primary" style={{ fontSize: 10, fontWeight: '700' }}>
                +{presence.length - 3}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const AVATAR_SIZE = 26;

function MarkerAvatar({ member, overlap }: { member: GymPresenceMember; overlap: boolean }) {
  const theme = useTheme();
  const background = avatarColor(member.user_id, theme.colors.avatarPalette);
  const initial = (member.display_name.trim()[0] ?? '?').toUpperCase();

  return (
    <View
      accessibilityLabel={`${member.display_name} is here`}
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: overlap ? -AVATAR_SIZE * 0.3 : 0,
        borderWidth: 2,
        // Green ring: this avatar means "checked in at this gym right now".
        borderColor: theme.colors.primary,
      }}
    >
      {/* Derived from the background: the dark avatar palette includes a
          near-white entry, on which white initials vanish. */}
      <Text
        style={{
          fontSize: 11,
          lineHeight: 14,
          fontWeight: '700',
          color: readableTextOn(background),
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

function MapControl({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text variant="body" style={{ fontWeight: '700', lineHeight: 20 }}>
        {icon}
      </Text>
    </Pressable>
  );
}

/**
 * Reset bearing / north.
 *
 * Always present rather than appearing only once the map is rotated: a control
 * that materialises when you need it is a control you never learned about. It
 * highlights when the camera is off north or tilted, and states the current
 * bearing so the button explains what it will undo.
 */
function ResetNorthControl({
  bearing,
  active,
  onPress,
}: {
  bearing: number;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        active
          ? `Reset to north and overhead view. Map is rotated ${Math.round(Math.abs(bearing))} degrees.`
          : 'Reset to north and overhead view. Already facing north.'
      }
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: active ? theme.colors.primary : theme.colors.surface,
          borderColor: active ? theme.colors.primary : theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View
        style={{
          // The needle turns with the map, so it reads as a compass rather than
          // a decorative arrow.
          transform: [{ rotate: `${-bearing}deg` }],
          alignItems: 'center',
        }}
      >
        <Text
          variant="caption"
          style={{
            fontWeight: '700',
            fontSize: 15,
            lineHeight: 17,
            color: active ? theme.colors.textOnPrimary : theme.colors.text,
          }}
        >
          ↑
        </Text>
      </View>
      <Text
        variant="caption"
        style={{
          fontSize: 8,
          lineHeight: 10,
          fontWeight: '700',
          color: active ? theme.colors.textOnPrimary : theme.colors.textMuted,
        }}
      >
        N
      </Text>
    </Pressable>
  );
}

/**
 * A zoom level that puts roughly `radiusMetres` on screen.
 *
 * Web Mercator halves ground resolution per zoom level, so this is a log2
 * relationship rather than a table of magic numbers. Clamped to sane bounds so a
 * 25 km radius does not open at continent scale.
 */
function zoomForRadius(radiusMetres: number): number {
  const safeRadius = radiusMetres > 0 ? radiusMetres : 5000;
  // 1000 m across the viewport is comfortable at about zoom 15.
  const zoom = 15 - Math.log2(safeRadius / 1000);
  return Math.min(16, Math.max(9, zoom));
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
  },
  controls: {
    position: 'absolute',
    gap: 6,
  },
  control: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  overflow: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -AVATAR_SIZE * 0.3,
    borderWidth: 2,
  },
});
