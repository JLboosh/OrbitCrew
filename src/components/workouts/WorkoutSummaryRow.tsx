import { Pressable, StyleSheet, View } from 'react-native';

import type { WorkoutSummary } from '@/api';
import { Text } from '@/components/ui';
import { categoryEmoji, describeCategories, sessionCategoryKeys } from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

export interface WorkoutSummaryRowProps {
  workout: WorkoutSummary;
  onPress?: (sessionId: string) => void;
  divider?: boolean;
}

/**
 * One finished workout in a history list.
 *
 * "💪 Chest + Triceps / 1h 08m · 7 exercises" — the type first, because that is
 * what someone scanning their history is looking for. A list of dates and
 * durations tells you that you trained; it does not tell you what you trained,
 * which is the thing you need before planning tomorrow.
 *
 * LEGACY SESSIONS STILL WORK. Rows logged before `workout_categories` existed have
 * an empty array, so the type is reconstructed from the muscle groups they
 * actually contain and marked as inferred. Nothing in the history disappears or
 * reads as "Unknown" because of the schema change.
 */
export function WorkoutSummaryRow({ workout, onPress, divider = false }: WorkoutSummaryRowProps) {
  const theme = useTheme();

  const { keys, inferred } = sessionCategoryKeys(workout.workout_categories, workout.muscles);
  const label = describeCategories(keys, 'Workout');
  const emoji = categoryEmoji(keys);

  const detail = [
    formatDuration(workout.duration_seconds),
    `${workout.exerciseCount} ${workout.exerciseCount === 1 ? 'exercise' : 'exercises'}`,
    workout.setCount > 0 ? `${workout.setCount} sets` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const body = (
    <View
      style={[
        styles.row,
        {
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.md,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.primarySoft,
        }}
      >
        <Text
          style={{ fontSize: 19, lineHeight: 24 }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {emoji}
        </Text>
      </View>

      <View style={styles.body}>
        <Text variant="subheading" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>

      <View style={styles.when}>
        <Text variant="caption" tone="subtle">
          {relativeDay(workout.started_at)}
        </Text>
        {inferred ? (
          <Text variant="caption" tone="subtle" style={{ fontSize: 11 }}>
            from exercises
          </Text>
        ) : null}
      </View>
    </View>
  );

  const accessibilityLabel = `${relativeDay(workout.started_at)}: ${label}. ${detail}.${
    inferred ? ' Type inferred from the exercises logged.' : ''
  }`;

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the full workout with every set."
      onPress={() => onPress(workout.id)}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * "Today", "Yesterday", then the weekday, then the date.
 *
 * Recency is what a history list is read for, and "Today" is instantly meaningful
 * in a way that "Sep 17" is not. Falls back to a full date beyond a week, where a
 * weekday name becomes ambiguous.
 */
export function relativeDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return date.toLocaleDateString([], { weekday: 'long' });

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'In progress';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  when: {
    alignItems: 'flex-end',
  },
});
