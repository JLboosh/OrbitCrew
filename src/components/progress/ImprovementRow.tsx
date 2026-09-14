import { StyleSheet, View } from 'react-native';

import type { ExerciseProgressRow } from '@/api';
import { Text } from '@/components/ui';
import { formatPercentDelta, formatWeight, type WeightUnit } from '@/lib/units';
import { useTheme } from '@/theme';

export interface ImprovementRowProps {
  row: ExerciseProgressRow;
  weightUnit: WeightUnit;
}

/**
 * One exercise's estimated-1RM improvement, shown WITH ITS ENDPOINTS.
 *
 * This component exists to make the product rule structurally hard to break:
 * `exercise_progress()` returns baseline and current alongside the percentage, and
 * this row always renders "135 lb → 185 lb" next to "+37%". There is no prop for
 * showing the percentage on its own.
 *
 * A missing baseline is a real case, not an error — a bodyweight movement, or a
 * first-ever logged set where baseline and current are the same entry. It shows
 * the current estimate and says the baseline is still being established, rather
 * than inventing 0% or hiding the exercise.
 */
export function ImprovementRow({ row, weightUnit }: ImprovementRowProps) {
  const theme = useTheme();

  const baseline = numberOrNull(row.baseline_1rm_kg);
  const current = numberOrNull(row.current_1rm_kg);
  const percentValue = numberOrNull(row.improvement_percent);
  const percent = formatPercentDelta(percentValue);

  const hasComparison = baseline !== null && current !== null && baseline > 0;
  const measurement = hasComparison
    ? `${formatWeight(baseline, weightUnit)} → ${formatWeight(current, weightUnit)}`
    : formatWeight(current, weightUnit);

  const accessibilityLabel = hasComparison
    ? `${row.exercise_name}, estimated one-rep max ${measurement}${percent ? `, ${percent}` : ''}`
    : `${row.exercise_name}, estimated one-rep max ${measurement}, baseline not established yet`;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { paddingVertical: theme.spacing.sm, gap: theme.spacing.md }]}
    >
      <View style={styles.body}>
        <Text variant="body" numberOfLines={1}>
          {row.exercise_name}
        </Text>
        <Text variant="caption" tone="muted">
          {measurement}
          {hasComparison ? '' : ' · baseline still being set'}
        </Text>
      </View>

      {percent && hasComparison ? (
        <Text
          variant="subheading"
          // Only an increase gets the success tone. Flat or down stays neutral:
          // strength fluctuates, and colouring a dip as a failure would be both
          // discouraging and misleading. There is no "bad" red here by design.
          tone={percentValue !== null && percentValue > 0 ? 'success' : 'muted'}
        >
          {percent}
        </Text>
      ) : null}
    </View>
  );
}

/** PostgREST can hand back numerics as strings, so coerce before arithmetic. */
function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    flex: 1,
  },
});
