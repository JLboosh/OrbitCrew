import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import type { GymMapViewProps } from './GymMapView.types';

import type { NearbyGym } from '@/api';
import { Text } from '@/components/ui';
import {
  formatDistance,
  projectToUnitSquare,
  unprojectFromUnitSquare,
  type DistanceSystem,
  type LatLng,
} from '@/lib/geo';
import { useTheme } from '@/theme';

/**
 * NATIVE gym map: a schematic plan view of nearby gyms.
 *
 * On web this file is not used at all — Metro resolves `GymMapView.web.tsx`, a
 * real MapLibre map with a 3D University of Waterloo campus mode. This remains
 * the native implementation, and the two share `GymMapViewProps`.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * Distances and bearings are accurate and to scale. Streets, coastlines, and
 * buildings are not drawn. It is a radar-style plot, not a street map, and the UI
 * says so out loud rather than letting a member assume otherwise — a map missing
 * a river between them and a gym would be actively misleading.
 *
 * WHY NATIVE DOES NOT GET THE REAL MAP
 * ------------------------------------
 * `maplibre-gl` is a browser library: it needs WebGL and a DOM, so it cannot run
 * under React Native. The native equivalent, `@maplibre/maplibre-react-native`,
 * is a NATIVE module, so Expo Go cannot load it — it needs a development build
 * (`npx expo prebuild`), which changes how everyone on the project runs the app
 * daily. That is a deliberate, separate decision from shipping the web map.
 *
 * SWAPPING IT IN stays a contained change: keep `GymMapViewProps` as it is,
 * render a `MapView` with a `ShapeSource`/`SymbolLayer` built from the same
 * `gyms`, and call `onSelectGym` from the feature press handler. Two things must
 * carry over: the "© OpenStreetMap contributors" attribution, which is a licence
 * condition, and the rule that no marker is ever drawn at a USER's position.
 */

const PIN_SIZE = 30;
/** Pins closer together than this are nudged apart so both stay tappable. */
const MIN_PIN_GAP = PIN_SIZE * 0.92;

interface PlottedPin {
  gym: NearbyGym;
  /** 1-based, matching the numbered list beneath the plot. */
  label: number;
  left: number;
  top: number;
}

export function GymMapView({
  origin,
  gyms,
  radiusMetres,
  selectedGymId,
  onSelectGym,
  distanceSystem = 'metric',
  pinMode = false,
  pinLocation = null,
  onPickLocation,
}: GymMapViewProps) {
  const theme = useTheme();
  const [size, setSize] = useState(0);

  const { latitude, longitude } = origin;

  const pins = useMemo(
    () => layoutPins(gyms, { latitude, longitude }, radiusMetres, size),
    [gyms, latitude, longitude, radiusMetres, size],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    // Square plot: a non-square one would distort bearings.
    if (width > 0 && Math.abs(width - size) > 1) setSize(width);
  };

  const midRadiusLabel = formatDistance(radiusMetres / 2, distanceSystem);
  const outerRadiusLabel = formatDistance(radiusMetres, distanceSystem);
  const gymNoun = gyms.length === 1 ? 'gym' : 'gyms';
  const summaryLabel = pinMode
    ? `Schematic map. Tap anywhere to place the new gym. ${gyms.length} existing ${gymNoun} shown for reference.`
    : `Schematic map of ${gyms.length} nearby ${gymNoun} within ${outerRadiusLabel}`;

  /**
   * Turns a tap into a coordinate.
   *
   * Exact rather than approximate: the plot uses an equirectangular projection, so
   * `unprojectFromUnitSquare` is its true inverse. A tap really does mean the place
   * it looks like it means.
   */
  const onPlotPress = (event: GestureResponderEvent) => {
    if (!pinMode || !onPickLocation || size <= 0) return;

    const { locationX, locationY } = event.nativeEvent;
    onPickLocation(
      unprojectFromUnitSquare(
        { latitude, longitude },
        { x: locationX / size, y: locationY / size },
        radiusMetres,
      ),
    );
  };

  const pinOffset =
    pinLocation && size > 0
      ? projectToUnitSquare({ latitude, longitude }, pinLocation, radiusMetres)
      : null;

  const Plot = pinMode ? Pressable : View;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Plot
        onLayout={onLayout}
        onPress={pinMode ? onPlotPress : undefined}
        accessibilityRole={pinMode ? 'button' : 'summary'}
        accessibilityLabel={summaryLabel}
        accessibilityHint={pinMode ? 'Places the pin where you tap.' : undefined}
        style={[
          styles.plot,
          {
            backgroundColor: theme.colors.surfaceMuted,
            borderColor: pinMode ? theme.colors.primary : theme.colors.border,
            borderRadius: theme.radius.lg,
          },
        ]}
      >
        {size > 0 ? (
          <>
            {/* Distance rings. Circular because the projection keeps them so. */}
            <Ring size={size} fraction={1} color={theme.colors.border} />
            <Ring size={size} fraction={0.5} color={theme.colors.border} />

            {/* Ring scale labels, on the north axis. */}
            <RingLabel top={2} text={outerRadiusLabel} />
            <RingLabel top={size * 0.25 - 8} text={midRadiusLabel} />

            {/* North indicator: without it, "up" means nothing. */}
            <View style={[styles.north, { right: theme.spacing.sm, top: theme.spacing.xs }]}>
              <Text variant="caption" tone="subtle">
                N ↑
              </Text>
            </View>

            {/* The member's own position: a plain dot, never shared or stored. */}
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[
                styles.origin,
                {
                  left: size / 2 - 5,
                  top: size / 2 - 5,
                  backgroundColor: theme.colors.accent,
                },
              ]}
            />

            {pins.map((pin) => (
              <GymPin
                key={pin.gym.id}
                pin={pin}
                selected={pin.gym.id === selectedGymId}
                distanceSystem={distanceSystem}
                onPress={onSelectGym}
              />
            ))}

            {/* The candidate location for a new gym. Coral rather than green so it
                is obviously not one of the existing gyms yet. */}
            {pinOffset ? (
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={[
                  styles.dropPin,
                  {
                    left: clamp(pinOffset.x, 0, 1) * size - PIN_SIZE / 2,
                    top: clamp(pinOffset.y, 0, 1) * size - PIN_SIZE / 2,
                    backgroundColor: theme.colors.accent,
                    borderColor: theme.colors.surface,
                  },
                ]}
              />
            ) : null}
          </>
        ) : null}
      </Plot>

      <Text variant="caption" tone="subtle">
        {pinMode
          ? 'Tap the plot to place your gym. Distances and directions are to scale, so the position is exact even though streets are not drawn.'
          : 'Schematic view: distances and directions are to scale, streets are not shown. Numbers match the list below.'}
      </Text>
    </View>
  );
}

function GymPin({
  pin,
  selected,
  distanceSystem,
  onPress,
}: {
  pin: PlottedPin;
  selected: boolean;
  distanceSystem: DistanceSystem;
  onPress: (gym: NearbyGym) => void;
}) {
  const theme = useTheme();
  const distance = formatDistance(pin.gym.distance_metres, distanceSystem);

  return (
    <Pressable
      onPress={() => onPress(pin.gym)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${pin.label}. ${pin.gym.name}, ${distance} away`}
      style={[
        styles.pin,
        {
          left: pin.left,
          top: pin.top,
          backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
        },
      ]}
    >
      <Text
        variant="caption"
        style={{
          color: selected ? theme.colors.textOnPrimary : theme.colors.text,
          fontWeight: '600',
        }}
      >
        {pin.label}
      </Text>
    </Pressable>
  );
}

function RingLabel({ top, text }: { top: number; text: string }) {
  return (
    <View style={[styles.ringLabel, { top }]}>
      <Text variant="caption" tone="subtle">
        {text}
      </Text>
    </View>
  );
}

function Ring({ size, fraction, color }: { size: number; fraction: number; color: string }) {
  const diameter = size * fraction;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.ring,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderColor: color,
          left: (size - diameter) / 2,
          top: (size - diameter) / 2,
        },
      ]}
    />
  );
}

/**
 * Projects each gym to pixel coordinates, then nudges overlapping pins apart.
 *
 * Nearest-first input order matters: closer gyms are placed first and keep their
 * true position, so any displacement lands on the less relevant pin. The offset
 * walks a deterministic golden-angle spiral rather than using randomness, so the
 * layout does not jitter between renders.
 */
function layoutPins(
  gyms: NearbyGym[],
  origin: LatLng,
  radiusMetres: number,
  size: number,
): PlottedPin[] {
  if (size <= 0) return [];

  const half = PIN_SIZE / 2;
  const placed: PlottedPin[] = [];

  gyms.forEach((gym, index) => {
    const projected = projectToUnitSquare(origin, gym, radiusMetres);
    const baseX = clamp(projected.x, 0, 1) * size;
    const baseY = clamp(projected.y, 0, 1) * size;

    let centreX = baseX;
    let centreY = baseY;

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const candidateX = clamp(centreX, half, size - half);
      const candidateY = clamp(centreY, half, size - half);

      const collides = placed.some(
        (other) =>
          Math.hypot(other.left + half - candidateX, other.top + half - candidateY) < MIN_PIN_GAP,
      );

      if (!collides) {
        centreX = candidateX;
        centreY = candidateY;
        break;
      }

      const angle = attempt * 2.399963;
      const distance = MIN_PIN_GAP * (0.85 + attempt * 0.18);
      centreX = baseX + Math.cos(angle) * distance;
      centreY = baseY + Math.sin(angle) * distance;
    }

    placed.push({
      gym,
      label: index + 1,
      left: clamp(centreX, half, size - half) - half,
      top: clamp(centreY, half, size - half) - half,
    });
  });

  return placed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  plot: {
    width: '100%',
    aspectRatio: 1,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ringLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  north: {
    position: 'absolute',
  },
  origin: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pin: {
    position: 'absolute',
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  dropPin: {
    position: 'absolute',
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    borderWidth: 3,
  },
});
