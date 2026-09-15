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
  /** Shows the label and "29 / 36" above the bar. */
  showCounts?: boolean;
  /** Unit noun for the accessible summary, e.g. "sessions". */
  unit?: string;
  /** Bar thickness. The design uses a chunky 10px track. */
  height?: number;
}

/**
 * Progress indicator for crew goals and challenges.
 *
 * Never renders a "failure" colour. Being behind shows as an incomplete neutral
 * track; hitting the target switches the fill to the success tone. Falling short
 * must never look like an error.
 */
export function ProgressBar({
  value,
  target,
  label,
  showCounts = true,
  unit = '',
  height = 10,
}: ProgressBarProps) {
  const theme = useTheme();

  // Guard against a zero or negative target, which would yield NaN/Infinity.
  const safeTarget = target > 0 ? target : 1;
  const ratio = Math.min(Math.max(value / safeTarget, 0), 1);
  const percent = Math.round(ratio * 100);
  const complete = value >= target;
  const unitSuffix = unit ? ` ${unit}` : '';

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      // Screen readers announce the real numbers, not just a percentage.
      accessibilityValue={{
        min: 0,
        max: safeTarget,
        now: value,
        text: `${value} of ${target}${unitSuffix}, ${percent} percent`,
      }}
      style={{ gap: theme.spacing.sm }}
    >
      {showCounts ? (
        <View style={styles.counts}>
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="caption" tone={complete ? 'success' : 'muted'} style={styles.value}>
            {value} / {target}
            {unitSuffix}
          </Text>
        </View>
      ) : null}

      <View
        style={{
          height,
          backgroundColor: theme.colors.track,
          borderRadius: theme.radius.pill,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: complete ? theme.colors.success : theme.colors.primary,
            borderRadius: theme.radius.pill,
          }}
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
  value: {
    fontWeight: '600',
  },
});
