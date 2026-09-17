import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useActiveSession,
  useAddSessionExercise,
  useFinishWorkout,
  useGym,
  useLogSet,
  useMyProfile,
  useRefreshDailyChallenge,
  useUpdateSessionNotes,
  useUpdateWorkoutCategories,
  type Exercise,
  type FinishedWorkout,
} from '@/api';
import { Button, Card, Screen, Text, TextField, useConfirm } from '@/components/ui';
import {
  ExerciseBlock,
  ExercisePicker,
  WorkoutTypePicker,
  formatDuration,
} from '@/components/workouts';
import { errorMessage } from '@/lib/errors';
import { defaultSetValues } from '@/lib/exerciseEntry';
import {
  categoryEmoji,
  describeCategories,
  knownCategories,
  type WorkoutCategoryKey,
} from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

/**
 * The active workout.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This screen used to show, for every exercise at once: a list of logged sets, a
 * weight field, a reps field, a warm-up toggle, a "Log set" button, and a "Remove"
 * button — then an exercise search across the entire library underneath. Used
 * standing up between sets, that is too much to parse.
 *
 * Now it is a title, a clock, a list of exercises with their sets, and two
 * actions. Adding a set is one tap and copies the previous set's numbers; the
 * exercise picker is a step you enter and leave rather than a permanent fixture;
 * notes are there when wanted and invisible when not.
 *
 * The constraints that shaped the original still hold: used one-handed, sweaty
 * screen, low attention. So targets stay large, numeric keypads are used, and
 * nothing is ever lost — every edit writes immediately, so closing the app
 * mid-workout costs nothing.
 */
export default function ActiveSessionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const confirm = useConfirm();

  const { data: session, isLoading, isError, error, refetch } = useActiveSession();
  const { data: profile } = useMyProfile();

  const finish = useFinishWorkout();
  const refreshDaily = useRefreshDailyChallenge();
  const updateNotes = useUpdateSessionNotes();
  const updateCategories = useUpdateWorkoutCategories();
  const addExercise = useAddSessionExercise();
  const logSet = useLogSet();

  const [picking, setPicking] = useState(false);
  const [editingType, setEditingType] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [finished, setFinished] = useState<FinishedWorkout | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * The notes field, DERIVED rather than synchronised.
   *
   * `null` means "the member has not typed anything yet", so the saved value shows
   * through. An effect copying `session.notes` into state would be a second source
   * of truth for the same string, and the version that fights hardest wins — which
   * in practice means a background refetch overwriting half-typed text.
   */
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const savedNotes = session?.notes ?? '';
  const notes = notesDraft ?? savedNotes;
  // Open automatically when there is something to show, without an effect.
  const notesOpen = notesExpanded || savedNotes.length > 0;

  const entries = useMemo(
    () => [...(session?.session_exercises ?? [])].sort((a, b) => a.order_index - b.order_index),
    [session?.session_exercises],
  );

  const preferredUnit = profile?.weight_unit ?? 'lb';

  // The completion summary. Shown after the session row is gone, which is why it
  // is checked before the "no active session" branch below.
  if (finished) {
    return <WorkoutComplete summary={finished} onDone={() => router.replace('/(tabs)')} />;
  }

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
          <Text variant="subheading">Could not load your workout</Text>
          <Text variant="caption" tone="muted">
            {errorMessage(error, 'Something went wrong reading the session. Nothing was lost.')}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => refetch()} />
        </Card>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen title="No workout in progress" subtitle="Start one and pick what you are training.">
        <Button
          label="Start a workout"
          icon="play"
          size="large"
          fullWidth
          onPress={() => router.replace('/session/new')}
        />
        <Button label="Back to Today" variant="ghost" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }

  const categories = session.workout_categories ?? [];
  const title = `${categoryEmoji(categories)} ${describeCategories(categories, 'Workout')}`;

  const addExerciseToSession = async (exercise: Exercise) => {
    setActionError(null);
    try {
      const created = await addExercise.mutateAsync({
        sessionId: session.id,
        exerciseId: exercise.id,
        orderIndex: entries.length,
      });

      // Seeds the first set immediately. An exercise with no sets is a row the
      // member has to act on twice before recording anything.
      const defaults = defaultSetValues(exercise);
      await logSet.mutateAsync({
        sessionExerciseId: created.id,
        setIndex: 0,
        weight: defaults.weight,
        weightUnit: preferredUnit,
        reps: defaults.reps,
        durationSeconds: defaults.durationSeconds,
        isWarmup: false,
      });

      setPicking(false);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not add that exercise.'));
    }
  };

  const onFinish = async () => {
    const loggedSets = entries.reduce((total, entry) => total + entry.sets.length, 0);

    const confirmed = await confirm({
      title: 'Finish workout?',
      message:
        loggedSets === 0
          ? 'You have not logged any sets. The workout will still be recorded.'
          : `${loggedSets} ${loggedSets === 1 ? 'set' : 'sets'} across ${entries.length} ${
              entries.length === 1 ? 'exercise' : 'exercises'
            }. Everything is already saved.`,
      confirmLabel: 'Finish',
      cancelLabel: 'Keep going',
    });
    if (!confirmed) return;

    setActionError(null);
    try {
      const summary = await finish.mutateAsync(session);
      // Pushes today's challenge forward straight away rather than leaving the
      // member to wonder why it still says 0 of 1.
      refreshDaily.mutate();
      setFinished(summary);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not finish the workout. Your sets are saved.'));
    }
  };

  return (
    <Screen title={title} subtitle={undefined}>
      {/* Clock and context, in one compact card. */}
      <Card variant="feature" style={{ gap: theme.spacing.sm }}>
        <View style={styles.between}>
          <ElapsedTimer startedAt={session.started_at} />
          <Button
            label="Change type"
            variant="ghost"
            size="small"
            accessibilityLabel="Change what you are training"
            onPress={() => setEditingType((open) => !open)}
          />
        </View>
        <GymLine gymId={session.gym_id} />
      </Card>

      {editingType ? (
        <Card>
          <Text variant="subheading" heading>
            Change what you are training
          </Text>
          <WorkoutTypePicker
            selected={knownCategories(categories).map((category) => category.key)}
            onChange={(next: WorkoutCategoryKey[]) =>
              updateCategories.mutate({ sessionId: session.id, workoutCategories: next })
            }
          />
          <Button label="Done" variant="secondary" onPress={() => setEditingType(false)} />
        </Card>
      ) : null}

      {/* Exercises. The substance of the screen. */}
      <Card style={{ gap: theme.spacing.lg }}>
        <Text variant="heading" heading>
          Exercises
        </Text>

        {entries.length === 0 ? (
          <Text variant="caption" tone="muted">
            Nothing added yet. Add your first exercise below — only the ones that fit{' '}
            {describeCategories(categories, 'your workout').toLowerCase()} are shown.
          </Text>
        ) : (
          entries.map((entry) => (
            <ExerciseBlock key={entry.id} entry={entry} preferredUnit={preferredUnit} />
          ))
        )}

        {!picking ? (
          <Button
            label="+ Add exercise"
            variant="secondary"
            fullWidth
            onPress={() => setPicking(true)}
          />
        ) : null}
      </Card>

      {picking ? (
        <ExercisePicker
          categories={categories}
          alreadyAddedIds={entries.flatMap((entry) => (entry.exercise ? [entry.exercise.id] : []))}
          onPick={addExerciseToSession}
          footer={<Button label="Done adding" variant="ghost" onPress={() => setPicking(false)} />}
        />
      ) : null}

      {/* Session-wide notes, folded away until wanted. */}
      {notesOpen ? (
        <Card>
          <TextField
            label="Workout notes"
            value={notes}
            onChangeText={setNotesDraft}
            onBlur={() => {
              if (savedNotes === notes.trim()) return;
              updateNotes.mutate({ sessionId: session.id, notes });
            }}
            placeholder="How it felt, what to change next time"
            multiline
            maxLength={2000}
          />
        </Card>
      ) : (
        <Button
          label="+ Add workout notes"
          variant="ghost"
          onPress={() => setNotesExpanded(true)}
        />
      )}

      <Button
        label="Finish workout"
        size="large"
        fullWidth
        loading={finish.isPending}
        onPress={onFinish}
      />

      {actionError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {actionError}
        </Text>
      ) : null}

      <Text variant="caption" tone="subtle">
        Everything saves as you type. Sessions count toward your crew goal once they pass the
        crew&apos;s minimum length.
      </Text>
    </Screen>
  );
}

/**
 * What the member sees the moment they finish.
 *
 * The point is to close the loop the app is built around — train, see it counted,
 * see it reach your crew. So it names what was done, and states plainly which
 * downstream things have just been updated rather than leaving the member to go
 * looking for evidence that anything happened.
 */
function WorkoutComplete({ summary, onDone }: { summary: FinishedWorkout; onDone: () => void }) {
  const theme = useTheme();

  const label = describeCategories(summary.workoutCategories, 'Workout');
  const emoji = categoryEmoji(summary.workoutCategories);

  return (
    <Screen title="Nice work.">
      <Card variant="feature" style={{ gap: theme.spacing.md }}>
        <Text variant="display" heading>
          {emoji} {label}
        </Text>
        <Text variant="metric">
          {formatDuration(summary.durationSeconds)} ·{' '}
          {summary.exerciseCount === 1 ? '1 exercise' : `${summary.exerciseCount} exercises`}
        </Text>
        <Text variant="body" tone="muted">
          {summary.setCount === 1 ? '1 set' : `${summary.setCount} sets`} recorded.
        </Text>
      </Card>

      <Card>
        <Text variant="subheading" heading>
          What this updated
        </Text>
        <Text variant="caption" tone="muted">
          Your session count, training volume, weekly consistency, and any personal records from
          this workout. Your crew&apos;s weekly goal and the leaderboard count it as soon as it
          passes their minimum session length.
        </Text>
        <Text variant="caption" tone="muted">
          {summary.rescoredChallengeIds.length > 0
            ? `${summary.rescoredChallengeIds.length} ${
                summary.rescoredChallengeIds.length === 1 ? 'challenge' : 'challenges'
              } rescored, including today's.`
            : 'Challenge progress is recalculated whenever you open a challenge.'}
        </Text>
      </Card>

      <Button label="Done" size="large" fullWidth onPress={onDone} />
    </Screen>
  );
}

function GymLine({ gymId }: { gymId: string | null }) {
  const { data: gym } = useGym(gymId ?? undefined);

  return (
    <Text variant="caption" tone="muted">
      {!gymId ? 'No gym selected' : (gym?.name ?? 'Loading gym…')}
    </Text>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    <Text
      variant="metric"
      accessibilityLabel={`Elapsed ${hours > 0 ? `${hours} hours ` : ''}${minutes} minutes ${seconds} seconds`}
    >
      {hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
