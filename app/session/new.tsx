import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useActiveSession, useMyPresence, useStartSession } from '@/api';
import { Button, Card, Screen, Text } from '@/components/ui';
import { WorkoutTypePicker } from '@/components/workouts';
import { errorMessage } from '@/lib/errors';
import { describeCategories, type WorkoutCategoryKey } from '@/lib/workoutTypes';

/**
 * Step one of the workout flow: what are you training?
 *
 * The whole flow is Start workout → CHOOSE TYPE → choose exercises → track sets →
 * finish. This screen is the step that was missing, and adding it is what lets
 * every later step be short: the exercise list is filtered by what is chosen here,
 * the tracking screen has a title, and the finished workout has a type in the
 * history and in the crew feed.
 *
 * It is a modal on its own route rather than a mode inside the active-session
 * screen, so backing out of it does NOT create a session. A half-started workout
 * that counts toward a crew goal is worse than no workout.
 */
export default function NewWorkoutScreen() {
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId?: string }>();

  const { data: activeSession } = useActiveSession();
  const { data: presence } = useMyPresence();
  const startSession = useStartSession();

  const [selected, setSelected] = useState<WorkoutCategoryKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A unique partial index allows one in-progress session per member, so a second
  // start would fail at the database. Offering to resume is the useful response.
  if (activeSession) {
    return (
      <Screen title="Already training" subtitle="You have a workout in progress.">
        <Card>
          <Text variant="body">
            Finish or leave the current workout before starting another one. Everything you logged
            is already saved.
          </Text>
          <Button
            label="Back to my workout"
            size="large"
            fullWidth
            onPress={() => router.replace('/session/active')}
          />
        </Card>
      </Screen>
    );
  }

  // Falls back to wherever the member is checked in, so a workout started from the
  // Today screen still attaches to the right gym without asking again.
  const resolvedGymId = gymId ?? presence?.gym_id ?? null;

  const start = async () => {
    if (selected.length === 0) return;
    setError(null);

    try {
      await startSession.mutateAsync({
        gymId: resolvedGymId,
        workoutCategories: selected,
      });
      router.replace('/session/active');
    } catch (err) {
      setError(errorMessage(err, 'Could not start the workout. Please try again.'));
    }
  };

  return (
    <Screen title="What are you training?" subtitle="Pick your day, then the exercises follow.">
      <WorkoutTypePicker selected={selected} onChange={setSelected} />

      <Button
        label={selected.length > 0 ? `Start ${describeCategories(selected)}` : 'Start workout'}
        icon="play"
        size="large"
        fullWidth
        disabled={selected.length === 0}
        loading={startSession.isPending}
        onPress={start}
      />

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
    </Screen>
  );
}
