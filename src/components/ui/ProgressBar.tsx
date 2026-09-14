import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface ProgressBarProps {
  /** Completed amount (e.g. 29 sessions). */
  value: number;
  /** Target amount (e.g. 36 sessions). */
  target: number;
  /** Accessible description, e.g. "Crew weekly goal". */
  label: string;
  /** Shows "29 / 36" above the bar. */
  showCounts?: boolean;
  /** Unit noun for the accessible summary, e.g. "sessions". */
  unit?: string;
}

/**
 * Progress indicator for crew weekly goals and challenges.
 *
 * Deliberately never renders a "failure" colour. Being behind on a goal is
 * shown as an incomplete neutral track, and reaching the target switches to a
 * success colour. Falling short must never look like an error.
 */
export function ProgressBar({
  value,
  target,
  label,
  showCounts = true,
  unit = '',
}: ProgressBarProps) {
  const theme = useTheme();

  // Guard against a zero or negative target, which would produce NaN/Infinity.
  const safeTarget = target > 0 ? target : 1;
  const ratio = Math.min(Math.max(value / safeTarget, 0), 1);
  const percent = Math.round(ratio * 100);
  const complete = value >= target;

  const fillColor = complete ? theme.colors.success : theme.colors.primary;
  const unitSuffix = unit ? ` ${unit}` : '';

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      // Screen readers announce the real numbers, not just the percentage.
      accessibilityValue={{
        min: 0,
        max: safeTarget,
        now: value,
        text: `${value} of ${target}${unitSuffix}, ${percent} percent`,
      }}
      style={{ gap: theme.spacing.xs }}
    >
      {showCounts ? (
        <View style={styles.counts}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="caption" tone={complete ? 'success' : 'muted'}>
            {value} / {target}
            {unitSuffix}
          </Text>
        </View>
      ) : null}

      <View
        style={[
          styles.track,
          { backgroundColor: theme.colors.track, borderRadius: theme.radius.pill },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${percent}%`,
              backgroundColor: fillColor,
              borderRadius: theme.radius.pill,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  counts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  track: {
    height: 10,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
