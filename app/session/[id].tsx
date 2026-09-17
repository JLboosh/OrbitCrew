import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useGym, useMyProfile, useSession, type SessionDetail, type SetRow } from '@/api';
import { Card, Screen, Text } from '@/components/ui';
import { formatDuration, relativeDay } from '@/components/workouts';
import { errorMessage } from '@/lib/errors';
import { formatWeight, type WeightUnit } from '@/lib/units';
import { categoryEmoji, describeCategories, sessionCategoryKeys } from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

/**
 * A finished workout, in full.
 *
 * Reached by tapping a row in the history. Everything a member could want to know
 * about a past session in one place: what they trained, how long it took, and every
 * exercise, set, weight, rep, and note.
 *
 * WEIGHTS ARE SHOWN AS ENTERED. `sets.weight` plus `sets.weight_unit` is what the
 * member typed; `weight_kg` is the generated canonical value used for comparison. A
 * 135 lb bench is displayed as "135 lb", not as "61 kg" converted back, so history
 * never drifts from what actually happened. Only the estimated 1RM — which is
 * computed in kilograms — is converted for display.
 */
export default function WorkoutDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: session, isLoading, isError, error } = useSession(id);
  const { data: profile } = useMyProfile();

  const preferredUnit = profile?.weight_unit ?? 'lb';

  if (isLoading) {
    return (
      <Screen title="Workout">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen title="Workout">
        <Card>
          <Text variant="subheading">Could not load that workout</Text>
          <Text variant="caption" tone="muted">
            {errorMessage(error, 'Something went wrong reading the session.')}
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen title="Workout">
        <Card>
          <Text variant="subheading">Not found</Text>
          <Text variant="caption" tone="muted">
            This workout does not exist, or it belongs to another account.
          </Text>
        </Card>
      </Screen>
    );
  }

  const entries = [...(session.session_exercises ?? [])].sort(
    (a, b) => a.order_index - b.order_index,
  );

  const { keys, inferred } = sessionCategoryKeys(
    session.workout_categories,
    entries.flatMap((entry) => (entry.exercise ? [entry.exercise.primary_muscle] : [])),
  );

  const setCount = entries.reduce((total, entry) => total + entry.sets.length, 0);

  return (
    <Screen
      title={`${categoryEmoji(keys)} ${describeCategories(keys, 'Workout')}`}
      subtitle={`${relativeDay(session.started_at)} · ${new Date(
        session.started_at,
      ).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}`}
    >
      <Card style={{ gap: theme.spacing.sm }}>
        <Text variant="metric">{formatDuration(session.duration_seconds)}</Text>
        <Text variant="caption" tone="muted">
          {entries.length === 1 ? '1 exercise' : `${entries.length} exercises`} ·{' '}
          {setCount === 1 ? '1 set' : `${setCount} sets`} · started{' '}
          {new Date(session.started_at).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
        <GymLine gymId={session.gym_id} />

        {inferred && entries.length > 0 ? (
          <Text variant="caption" tone="subtle">
            This workout predates workout types, so the type above is worked out from the muscle
            groups it contains rather than something you chose.
          </Text>
        ) : null}
      </Card>

      {session.notes ? (
        <Card>
          <Text variant="subheading" heading>
            Notes
          </Text>
          <Text variant="body">{session.notes}</Text>
        </Card>
      ) : null}

      {entries.length === 0 ? (
        <Card>
          <Text variant="caption" tone="muted">
            No exercises were logged in this session.
          </Text>
        </Card>
      ) : (
        entries.map((entry) => (
          <ExerciseDetail key={entry.id} entry={entry} preferredUnit={preferredUnit} />
        ))
      )}
    </Screen>
  );
}

function ExerciseDetail({
  entry,
  preferredUnit,
}: {
  entry: SessionDetail['session_exercises'][number];
  preferredUnit: WeightUnit;
}) {
  const theme = useTheme();
  const sets = [...entry.sets].sort((a, b) => a.set_index - b.set_index);

  const best = sets
    .filter((set) => !set.is_warmup && set.estimated_1rm_kg != null)
    .reduce<SetRow | null>((leader, set) => {
      if (leader?.estimated_1rm_kg == null) return set;
      return Number(set.estimated_1rm_kg) > Number(leader.estimated_1rm_kg) ? set : leader;
    }, null);

  return (
    <Card>
      <Text variant="subheading" heading>
        {entry.exercise?.name ?? 'Exercise'}
      </Text>

      {sets.length === 0 ? (
        <Text variant="caption" tone="muted">
          No sets recorded.
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {sets.map((set, index) => (
            <View
              key={set.id}
              accessible
              accessibilityLabel={`Set ${index + 1}: ${describeSet(set)}`}
              style={[styles.setRow, { paddingVertical: theme.spacing.xs }]}
            >
              <Text variant="caption" tone="subtle" style={styles.setNumber}>
                {index + 1}
              </Text>
              <Text variant="body" style={styles.setBody}>
                {describeSet(set)}
              </Text>
              {set.is_warmup ? (
                <Text variant="caption" tone="accent">
                  warm-up
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {/* The measurement, next to the estimate. No percentage without the number
          it came from. */}
      {best?.estimated_1rm_kg != null ? (
        <Text variant="caption" tone="muted">
          Best estimated one-rep max {formatWeight(Number(best.estimated_1rm_kg), preferredUnit)},
          from {best.weight} {best.weight_unit} × {best.reps}
        </Text>
      ) : null}

      {entry.notes ? (
        <Text variant="caption" tone="muted">
          {entry.notes}
        </Text>
      ) : null}
    </Card>
  );
}

function GymLine({ gymId }: { gymId: string | null }) {
  const { data: gym } = useGym(gymId ?? undefined);

  return (
    <Text variant="caption" tone="subtle">
      {!gymId ? 'No gym recorded' : (gym?.name ?? 'Loading gym…')}
    </Text>
  );
}

/** "135 lb × 5", "12 reps", "20 min". Shown exactly as it was entered. */
function describeSet(set: SetRow): string {
  const parts: string[] = [];

  if (set.weight != null) parts.push(`${set.weight} ${set.weight_unit}`);
  if (set.reps != null) parts.push(parts.length > 0 ? `× ${set.reps}` : `${set.reps} reps`);
  if (set.duration_seconds != null) parts.push(`${Math.round(set.duration_seconds / 60)} min`);

  return parts.join(' ') || '—';
}

const styles = StyleSheet.create({
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setNumber: {
    width: 18,
  },
  setBody: {
    flex: 1,
  },
});
