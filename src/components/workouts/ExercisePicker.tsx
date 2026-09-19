import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CustomExerciseForm } from './CustomExerciseForm';

import { useExercises, type Exercise, type MuscleGroup } from '@/api';
import { Button, Card, Text, TextField } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { describeCategories, musclesForCategories, workoutCategory } from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

export interface ExercisePickerProps {
  /** The workout's categories. Drives which exercises are offered. */
  categories: string[];
  /** Ids already in the session, shown as added rather than offered again. */
  alreadyAddedIds?: string[];
  onPick: (exercise: Exercise) => void;
  /** Rendered under the list, e.g. a Done button. */
  footer?: React.ReactNode;
}

/**
 * Exercises for the chosen workout type, and only those.
 *
 * THE POINT OF THE WHOLE FLOW IS THIS LIST BEING SHORT. Picking "Legs" used to
 * show the first twelve exercises in the library alphabetically, which meant
 * "Arnold Press" and "Barbell Curl" on leg day. Filtering by the muscle groups
 * behind the chosen categories turns a search problem back into a choosing
 * problem — seven relevant exercises you can tap, rather than fifty you have to
 * type past.
 *
 * Nothing is hidden irreversibly. "Show everything" is one tap away, because a
 * member doing an unplanned extra lift should not have to abandon the workout to
 * log it, and Full Body starts unfiltered by definition.
 *
 * The member's own custom exercises are in the same list as the canonical ones,
 * marked as theirs, because at the moment of choosing there is no difference that
 * matters.
 */
export function ExercisePicker({
  categories,
  alreadyAddedIds = [],
  onPick,
  footer,
}: ExercisePickerProps) {
  const theme = useTheme();
  const { data: exercises, isLoading, isError, error, refetch } = useExercises();

  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);

  const wantedMuscles = useMemo(() => musclesForCategories(categories), [categories]);
  const added = useMemo(() => new Set(alreadyAddedIds), [alreadyAddedIds]);

  // Null means the categories imposed no filter (Full Body, or nothing
  // chosen), which is different from "filter matched nothing".
  const unfiltered = wantedMuscles === null || showAll;

  const matches = useMemo(() => {
    const pool = exercises ?? [];
    const needle = query.trim().toLowerCase();

    const inScope = unfiltered
      ? pool
      : pool.filter((exercise) => wantedMuscles!.includes(exercise.primary_muscle));

    const searched = needle
      ? // Search always spans the whole library: someone typing a name knows
        // what they want, and hiding it because of a category filter would read
        // as the exercise not existing.
        pool.filter((exercise) => exercise.name.toLowerCase().includes(needle))
      : inScope;

    return [...searched].sort(byRelevance(wantedMuscles));
  }, [exercises, query, unfiltered, wantedMuscles]);

  const defaultMuscle = defaultMuscleFor(categories);

  if (creating) {
    return (
      <CustomExerciseForm
        defaultMuscle={defaultMuscle}
        onCreated={(exercise) => {
          setCreating(false);
          setQuery('');
          // Straight into the workout: creating an exercise mid-session is
          // always in service of logging it right now.
          onPick(exercise);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  return (
    <Card>
      <Text variant="subheading" heading>
        {unfiltered ? 'Choose an exercise' : `${describeCategories(categories)} exercises`}
      </Text>

      <TextField
        label="Search exercises"
        labelHidden
        value={query}
        onChangeText={setQuery}
        placeholder="Search all exercises…"
        autoCorrect={false}
      />

      {/* Prominent, and above the list rather than buried at the bottom: a member
          who needs it already knows the library does not have their exercise. */}
      <Button
        label="+ Add custom exercise"
        variant="secondary"
        fullWidth
        onPress={() => setCreating(true)}
      />

      {isLoading ? (
        <Text variant="caption" tone="muted">
          Loading exercises…
        </Text>
      ) : null}

      {isError ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" tone="danger">
            {errorMessage(error, 'Could not load the exercise library.')}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => refetch()} />
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.sm }}>
        {matches.map((exercise, index) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            added={added.has(exercise.id)}
            divider={index < matches.length - 1}
            onPress={() => onPick(exercise)}
          />
        ))}

        {!isLoading && !isError && matches.length === 0 ? (
          <Text variant="caption" tone="muted">
            {query.trim()
              ? 'Nothing matched. Add it as a custom exercise above.'
              : 'No exercises for this workout type yet.'}
          </Text>
        ) : null}
      </View>

      {wantedMuscles !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            showAll
              ? `Show only ${describeCategories(categories)} exercises`
              : 'Show every exercise in the library'
          }
          accessibilityState={{ expanded: showAll }}
          onPress={() => setShowAll((current) => !current)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Text variant="caption" tone="primary" style={{ fontWeight: '600' }}>
            {showAll ? `Back to ${describeCategories(categories)}` : 'Show everything'}
          </Text>
        </Pressable>
      ) : null}

      {footer}
    </Card>
  );
}

function ExerciseRow({
  exercise,
  added,
  divider,
  onPress,
}: {
  exercise: Exercise;
  added: boolean;
  divider: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const detail = [
    MUSCLE_LABELS[exercise.primary_muscle] ?? exercise.primary_muscle,
    EQUIPMENT_LABELS[exercise.equipment] ?? exercise.equipment,
    exercise.created_by ? 'yours' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${exercise.name}. ${detail}.${added ? ' Already in this workout.' : ''}`}
      accessibilityHint="Adds this exercise to the workout."
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.rowBody}>
        <Text variant="body" numberOfLines={1}>
          {exercise.name}
        </Text>
        <Text variant="caption" tone="subtle" numberOfLines={1}>
          {detail}
        </Text>
      </View>

      <Text variant="caption" tone={added ? 'success' : 'primary'} style={{ fontWeight: '600' }}>
        {added ? 'Added' : '+ Add'}
      </Text>
    </Pressable>
  );
}

/**
 * Orders exercises so the ones matching the chosen muscles come first.
 *
 * Matters when the filter is off — either because the member tapped "Show
 * everything" or because they are searching. The relevant exercises should still
 * be at the top rather than wherever the alphabet puts them.
 */
function byRelevance(wanted: MuscleGroup[] | null) {
  return (a: Exercise, b: Exercise): number => {
    if (wanted !== null) {
      const aMatch = wanted.includes(a.primary_muscle) ? 0 : 1;
      const bMatch = wanted.includes(b.primary_muscle) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    // The member's own exercises next: they added them because they use them.
    const aOwn = a.created_by ? 0 : 1;
    const bOwn = b.created_by ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;

    return a.name.localeCompare(b.name);
  };
}

/** A sensible pre-selection for a new custom exercise, from what is being trained. */
function defaultMuscleFor(categories: string[]): MuscleGroup {
  for (const key of categories) {
    const category = workoutCategory(key);
    const first = category?.muscles[0];
    if (first) return first;
  }
  return 'chest';
}

const MUSCLE_LABELS: Partial<Record<MuscleGroup, string>> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  full_body: 'Full body',
  cardio: 'Cardio',
};

const EQUIPMENT_LABELS: Partial<Record<Exercise['equipment'], string>> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  bands: 'Bands',
  cardio_machine: 'Cardio machine',
  other: 'Other',
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
});
