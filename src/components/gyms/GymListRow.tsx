import { Pressable, StyleSheet, View } from 'react-native';

import type { NearbyGym } from '@/api';
import { Text } from '@/components/ui';
import { formatDistance, type DistanceSystem } from '@/lib/geo';
import { readOpeningHours } from '@/lib/openingHours';
import { useTheme } from '@/theme';

export interface GymListRowProps {
  gym: NearbyGym;
  /** Matches the pin number on the schematic map. Omit when there is no map. */
  label?: number;
  selected?: boolean;
  distanceSystem?: DistanceSystem;
  onPress: (gym: NearbyGym) => void;
}

/**
 * One gym in the nearby list.
 *
 * Rating averages, friend visits, and live presence are deliberately NOT shown
 * here. Each needs its own query, so putting them on every row would fire a
 * request per gym on a list that can hold 50. They appear once a gym is selected,
 * which is also the point at which a member actually wants them.
 */
export function GymListRow({
  gym,
  label,
  selected = false,
  distanceSystem = 'metric',
  onPress,
}: GymListRowProps) {
  const theme = useTheme();

  const hours = readOpeningHours(gym.opening_hours);
  const distance = formatDistance(gym.distance_metres, distanceSystem);

  // Only stated when the expression was understood. An unparseable value shows
  // the raw text instead of a guess — telling someone a gym is closed when it is
  // open is the worst outcome here.
  const openState =
    hours?.isOpenNow === true ? 'Open now' : hours?.isOpenNow === false ? 'Closed now' : null;

  const accessibilityLabel = [label ? `${label}.` : null, gym.name, `${distance} away`, openState]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={() => onPress(gym)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      {label !== undefined ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted,
              borderColor: selected ? theme.colors.primary : theme.colors.border,
            },
          ]}
        >
          <Text
            variant="caption"
            style={{
              color: selected ? theme.colors.textOnPrimary : theme.colors.textMuted,
              fontWeight: '600',
            }}
          >
            {label}
          </Text>
        </View>
      ) : null}

      <View style={styles.body}>
        <Text variant="subheading" numberOfLines={1}>
          {gym.name}
        </Text>
        {gym.address ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {gym.address}
          </Text>
        ) : null}
        {openState ? (
          <Text variant="caption" tone={hours?.isOpenNow ? 'success' : 'muted'}>
            {openState}
            {hours?.todayLabel && !hours.alwaysOpen ? ` · ${hours.todayLabel}` : ''}
          </Text>
        ) : gym.opening_hours ? (
          <Text variant="caption" tone="subtle" numberOfLines={1}>
            {gym.opening_hours}
          </Text>
        ) : null}
      </View>

      <Text variant="body" tone="muted">
        {distance}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  body: {
    flex: 1,
  },
});
