import { StyleSheet, View } from 'react-native';

import type { WeekBucket } from '@/api';
import { Text } from '@/components/ui';
import { formatVolume, type WeightUnit } from '@/lib/units';
import { useTheme } from '@/theme';

const CHART_HEIGHT = 120;
/** Visible stub for an untrained week, so a gap reads as a gap and not as absence. */
const EMPTY_BAR_HEIGHT = 3;

export type WeeklyMetric = 'sessions' | 'volume';

export interface WeeklyBarsProps {
  /** Dense, oldest-first series from `toWeekBuckets`. */
  buckets: WeekBucket[];
  metric: WeeklyMetric;
  weightUnit: WeightUnit;
}

/**
 * Weekly bar chart for sessions or training volume.
 *
 * Hand-drawn with Views rather than pulling in a charting library: this is a
 * dozen rectangles, and a chart dependency would add native code, bundle weight,
 * and its own accessibility quirks for no benefit.
 *
 * TWO DELIBERATE CHOICES
 *   * A week with no training renders as a visible stub in the neutral track
 *     colour, never in red or with a warning. Being behind is not an error state
 *     — see the note in src/theme/colors.ts.
 *   * The series must be DENSE. `weekly_training_summary` omits weeks with no
 *     sessions, so passing its rows straight in would quietly compress a
 *     three-week break into a continuous line. `toWeekBuckets` fills the gaps.
 */
export function WeeklyBars({ buckets, metric, weightUnit }: WeeklyBarsProps) {
  const theme = useTheme();

  const values = buckets.map((bucket) =>
    metric === 'sessions' ? bucket.sessionCount : bucket.volumeKg,
  );
  const max = values.reduce((highest, value) => Math.max(highest, value), 0);

  const peakLabel =
    metric === 'sessions'
      ? `${Math.round(max)} ${max === 1 ? 'session' : 'sessions'}`
      : formatVolume(max, weightUnit);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.header}>
        <Text variant="caption" tone="muted">
          {metric === 'sessions' ? 'Sessions per week' : 'Volume per week'}
        </Text>
        {max > 0 ? (
          <Text variant="caption" tone="subtle">
            peak {peakLabel}
          </Text>
        ) : null}
      </View>

      <View style={[styles.chart, { height: CHART_HEIGHT, gap: 3 }]}>
        {buckets.map((bucket, index) => {
          const value = values[index] ?? 0;
          const ratio = max > 0 ? value / max : 0;
          const height = value > 0 ? Math.max(ratio * CHART_HEIGHT, 6) : EMPTY_BAR_HEIGHT;

          return (
            <View
              key={bucket.weekStart.toISOString()}
              accessibilityRole="text"
              accessibilityLabel={barLabel(bucket, metric, weightUnit)}
              style={styles.barSlot}
            >
              <View
                style={[
                  styles.bar,
                  {
                    height,
                    backgroundColor: value > 0 ? theme.colors.primary : theme.colors.track,
                    borderTopLeftRadius: theme.radius.sm,
                    borderTopRightRadius: theme.radius.sm,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* Only the ends are labelled: twelve rotated date labels would be noise. */}
      <View style={styles.header}>
        <Text variant="caption" tone="subtle">
          {rangeLabel(buckets[0])}
        </Text>
        <Text variant="caption" tone="subtle">
          This week
        </Text>
      </View>
    </View>
  );
}

function barLabel(bucket: WeekBucket, metric: WeeklyMetric, weightUnit: WeightUnit): string {
  const week = `Week of ${bucket.weekStart.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })}`;

  if (metric === 'sessions') {
    const count = bucket.sessionCount;
    return `${week}: ${count} ${count === 1 ? 'session' : 'sessions'}`;
  }
  return `${week}: ${formatVolume(bucket.volumeKg, weightUnit)}`;
}

function rangeLabel(bucket: WeekBucket | undefined): string {
  if (!bucket) return '';
  return bucket.weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  barSlot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
  },
});
