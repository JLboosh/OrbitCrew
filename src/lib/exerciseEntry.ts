import type { Database } from '@/types/database';

type Exercise = Database['public']['Tables']['exercises']['Row'];
type Equipment = Database['public']['Enums']['exercise_equipment'];
type MuscleGroup = Database['public']['Enums']['muscle_group'];

/** Which inputs a set row shows for a given exercise. */
export interface SetFields {
  weight: boolean;
  reps: boolean;
  /** Minutes, for work measured in time rather than repetitions. */
  duration: boolean;
}

export type ExerciseShape = Pick<Exercise, 'is_weighted' | 'equipment' | 'primary_muscle'>;

/**
 * Decides what a set row asks for.
 *
 * The point is to never show a field that cannot be filled in honestly. Three
 * cases, and the rule is drawn from data the schema already carries rather than
 * from a hardcoded list of exercise names:
 *
 *   * `is_weighted` — the column exists precisely so the UI can hide the weight
 *     field for bodyweight and cardio work. A "0 lb" pull-up is not a fact.
 *   * cardio machines — a treadmill has no meaningful rep count, so it asks for
 *     time only.
 *   * everything else unweighted — reps AND time, because "Push-Up × 12" and
 *     "Plank, 1 min" are both bodyweight work and both correct. Offering both and
 *     requiring neither is better than guessing which one a member means, and
 *     `sets_has_measurement` is satisfied by either.
 */
export function setFieldsFor(exercise: ExerciseShape | null | undefined): SetFields {
  if (!exercise) return { weight: true, reps: true, duration: false };

  if (exercise.is_weighted) {
    return { weight: true, reps: true, duration: false };
  }

  if (isTimeOnly(exercise.equipment, exercise.primary_muscle)) {
    return { weight: false, reps: false, duration: true };
  }

  return { weight: false, reps: true, duration: true };
}

function isTimeOnly(equipment: Equipment, muscle: MuscleGroup): boolean {
  return equipment === 'cardio_machine' || muscle === 'cardio';
}

/** Default values for a brand-new set when there is no previous one to copy. */
export function defaultSetValues(exercise: ExerciseShape | null | undefined): {
  weight: number | null;
  reps: number | null;
  durationSeconds: number | null;
} {
  const fields = setFieldsFor(exercise);

  return {
    // Left blank rather than zeroed: the member knows the weight, and a
    // pre-filled 0 is a number they have to notice and clear.
    weight: null,
    // A rep count is required by `sets_has_measurement` when there is no time or
    // weight, and 10 is the most common working set in the seeded library.
    reps: fields.reps ? 10 : null,
    durationSeconds: fields.duration && !fields.reps ? 600 : null,
  };
}
