import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useCreateCustomExercise,
  type Exercise,
  type ExerciseEquipment,
  type MuscleGroup,
} from '@/api';
import { Button, Card, Chip, Text, TextField } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

/**
 * Every muscle group, with the wording a member would use.
 *
 * Taken from the `muscle_group` enum rather than the workout categories: this
 * writes a row to `exercises.primary_muscle`, so it has to speak the database's
 * vocabulary exactly. Labelled for humans, valued for Postgres.
 */
const MUSCLE_OPTIONS: { value: MuscleGroup; label: string }[] = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'forearms', label: 'Forearms' },
  { value: 'quads', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'calves', label: 'Calves' },
  { value: 'core', label: 'Core' },
  { value: 'full_body', label: 'Full body' },
  { value: 'cardio', label: 'Cardio' },
];

const EQUIPMENT_OPTIONS: { value: ExerciseEquipment; label: string; weighted: boolean }[] = [
  { value: 'barbell', label: 'Barbell', weighted: true },
  { value: 'dumbbell', label: 'Dumbbell', weighted: true },
  { value: 'machine', label: 'Machine', weighted: true },
  { value: 'cable', label: 'Cable', weighted: true },
  { value: 'kettlebell', label: 'Kettlebell', weighted: true },
  { value: 'bands', label: 'Bands', weighted: false },
  { value: 'bodyweight', label: 'Bodyweight', weighted: false },
  { value: 'cardio_machine', label: 'Cardio machine', weighted: false },
  { value: 'other', label: 'Other', weighted: false },
];

export interface CustomExerciseFormProps {
  /** Pre-selects the muscle group, from whatever the member is training. */
  defaultMuscle?: MuscleGroup;
  onCreated: (exercise: Exercise) => void;
  onCancel: () => void;
}

/**
 * Create an exercise the default library does not have.
 *
 * Saved to the member's ACCOUNT, not the session: `exercises.created_by` is the
 * caller, so it is private to them and available in every future workout. That is
 * the difference between "log this one thing" and "my gym has a landmine, stop
 * asking me to improvise".
 *
 * `is_weighted` is inferred from the equipment rather than asked as a fourth
 * question. Barbell work takes a weight and bodyweight work does not, and the
 * inference is shown as an editable consequence rather than hidden — a resistance
 * band exercise someone does load can be corrected in one tap.
 */
export function CustomExerciseForm({
  defaultMuscle = 'chest',
  onCreated,
  onCancel,
}: CustomExerciseFormProps) {
  const theme = useTheme();
  const create = useCreateCustomExercise();

  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup>(defaultMuscle);
  const [equipment, setEquipment] = useState<ExerciseEquipment>('barbell');
  const [isWeighted, setIsWeighted] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2 && trimmed.length <= 80;

  const pickEquipment = (next: ExerciseEquipment) => {
    setEquipment(next);
    const option = EQUIPMENT_OPTIONS.find((entry) => entry.value === next);
    if (option) setIsWeighted(option.weighted);
  };

  const submit = async () => {
    setError(null);
    try {
      const exercise = await create.mutateAsync({
        name: trimmed,
        primaryMuscle: muscle,
        equipment,
        isWeighted,
        description: description.trim() || null,
      });
      onCreated(exercise);
    } catch (err) {
      setError(errorMessage(err, 'Could not save that exercise.'));
    }
  };

  return (
    <Card>
      <Text variant="subheading" heading>
        New exercise
      </Text>
      <Text variant="caption" tone="muted">
        Saved to your account, so it is there next time too. Only you can see it.
      </Text>

      <TextField
        label="Exercise name"
        value={name}
        onChangeText={setName}
        placeholder="Landmine Press"
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={80}
      />

      <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
        Muscle group
      </Text>
      <View style={[styles.chips, { gap: theme.spacing.sm }]}>
        {MUSCLE_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={muscle === option.value}
            onPress={() => setMuscle(option.value)}
          />
        ))}
      </View>

      <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
        Equipment
      </Text>
      <View style={[styles.chips, { gap: theme.spacing.sm }]}>
        {EQUIPMENT_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={equipment === option.value}
            onPress={() => pickEquipment(option.value)}
          />
        ))}
      </View>

      <View style={[styles.chips, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
        <Chip
          role="checkbox"
          label={isWeighted ? 'Logs a weight' : 'No weight'}
          active={isWeighted}
          accessibilityHint="Whether a weight field appears when you log a set of this exercise."
          onPress={() => setIsWeighted((current) => !current)}
        />
      </View>

      <TextField
        label="Notes (optional)"
        hint="Setup, cues, or which machine — anything you want to remember."
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={500}
        placeholder="Corner of the rack, feet staggered"
      />

      <View style={[styles.actions, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
        <Button
          label="Create exercise"
          disabled={!ready}
          loading={create.isPending}
          onPress={submit}
        />
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>

      {!ready && trimmed.length > 0 ? (
        <Text variant="caption" tone="subtle">
          Names are between 2 and 80 characters.
        </Text>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
