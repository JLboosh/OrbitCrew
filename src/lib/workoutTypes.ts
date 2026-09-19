import type { Database } from '@/types/database';

export type MuscleGroup = Database['public']['Enums']['muscle_group'];

/**
 * Workout categories: what the member says they are training, before they pick a
 * single exercise.
 *
 * WHY THIS LAYER EXISTS AT ALL
 * ----------------------------
 * The database already has a `muscle_group` enum, and the obvious move would be
 * to use it directly. But nobody walks into a gym thinking "today is quads,
 * hamstrings, glutes, and calves" — they think "legs". So the picker speaks in
 * training days, and this module is the single mapping from a training day to the
 * enum values that filter the exercise library. Both vocabularies stay honest:
 * the UI says "Legs", the query asks for four muscle groups, and neither has to
 * pretend to be the other.
 *
 * The finer-grained categories exist because the split people actually ask for is
 * "Chest + Triceps", not "Chest + Arms". They map one-to-one onto `muscle_group`,
 * so combining a broad category with a narrow one needs no special case.
 *
 * STORAGE. Selected keys are written to `sessions.workout_categories`. Its CHECK
 * constraint must permit every key below, so ADDING one here means adding it to
 * the constraint in a new migration first.
 *
 * The reverse is not true, and the constraint is currently a superset: it still
 * permits `'custom'`, from a "Custom Workout" option that has since been removed
 * from the product. Applied migrations are append-only (see AGENTS.md), and a
 * constraint that allows a value nothing writes is harmless — whereas a constraint
 * that forbids a value the picker offers breaks starting a workout.
 */
export type WorkoutCategoryKey =
  | 'legs'
  | 'arms'
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'core'
  | 'cardio'
  | 'full_body'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'biceps'
  | 'triceps'
  | 'forearms';

export interface WorkoutCategory {
  key: WorkoutCategoryKey;
  label: string;
  emoji: string;
  /**
   * Muscle groups whose exercises belong to this category. Empty means "do not
   * filter" — used by Full Body, which is about breadth rather than a particular
   * muscle.
   */
  muscles: MuscleGroup[];
  /**
   * `primary` categories fill the picker grid; `refinement` ones are revealed
   * behind "more muscle groups" so the first screen stays a glanceable grid rather
   * than a wall of sixteen tiles.
   */
  tier: 'primary' | 'refinement';
  /** One line explaining what a member gets by choosing it. */
  hint: string;
}

/**
 * The catalogue, in the order the picker shows it.
 *
 * Order is deliberate and matches the design: the six most common training days
 * as a 2-column grid, then the two full-width options.
 */
export const WORKOUT_CATEGORIES: readonly WorkoutCategory[] = [
  {
    key: 'legs',
    label: 'Legs',
    emoji: '🦵',
    muscles: ['quads', 'hamstrings', 'glutes', 'calves'],
    tier: 'primary',
    hint: 'Squats, presses, hinges, and calves',
  },
  {
    key: 'arms',
    label: 'Arms',
    emoji: '💪',
    muscles: ['biceps', 'triceps', 'forearms'],
    tier: 'primary',
    hint: 'Curls, extensions, and grip',
  },
  {
    key: 'chest',
    label: 'Chest',
    emoji: '🫀',
    muscles: ['chest'],
    tier: 'primary',
    hint: 'Presses, flyes, and push-ups',
  },
  {
    key: 'back',
    label: 'Back',
    emoji: '🪽',
    muscles: ['back'],
    tier: 'primary',
    hint: 'Pulls, rows, and deadlifts',
  },
  {
    key: 'core',
    label: 'Core',
    emoji: '🔥',
    muscles: ['core'],
    tier: 'primary',
    hint: 'Planks, crunches, and anti-rotation',
  },
  {
    key: 'shoulders',
    label: 'Shoulders',
    emoji: '🏋️',
    muscles: ['shoulders'],
    tier: 'primary',
    hint: 'Overhead presses and raises',
  },
  {
    key: 'cardio',
    label: 'Cardio',
    emoji: '🏃',
    muscles: ['cardio'],
    tier: 'primary',
    hint: 'Runs, rides, rows, and intervals',
  },
  {
    key: 'full_body',
    label: 'Full Body',
    emoji: '🌀',
    muscles: [],
    tier: 'primary',
    hint: 'The whole library, nothing filtered out',
  },
  // Refinements. One-to-one with `muscle_group`, so "Chest + Triceps" is a real
  // selection rather than an approximation of it.
  {
    key: 'quads',
    label: 'Quads',
    emoji: '🦿',
    muscles: ['quads'],
    tier: 'refinement',
    hint: 'Squats, presses, and extensions',
  },
  {
    key: 'hamstrings',
    label: 'Hamstrings',
    emoji: '🦵',
    muscles: ['hamstrings'],
    tier: 'refinement',
    hint: 'Hinges and curls',
  },
  {
    key: 'glutes',
    label: 'Glutes',
    emoji: '🍑',
    muscles: ['glutes'],
    tier: 'refinement',
    hint: 'Thrusts, bridges, and kickbacks',
  },
  {
    key: 'calves',
    label: 'Calves',
    emoji: '🦶',
    muscles: ['calves'],
    tier: 'refinement',
    hint: 'Standing and seated raises',
  },
  {
    key: 'biceps',
    label: 'Biceps',
    emoji: '💪',
    muscles: ['biceps'],
    tier: 'refinement',
    hint: 'Curls of every kind',
  },
  {
    key: 'triceps',
    label: 'Triceps',
    emoji: '🔻',
    muscles: ['triceps'],
    tier: 'refinement',
    hint: 'Pushdowns, extensions, and dips',
  },
  {
    key: 'forearms',
    label: 'Forearms',
    emoji: '🤝',
    muscles: ['forearms'],
    tier: 'refinement',
    hint: 'Wrist work and carries',
  },
] as const;

/** How many categories one session may carry. Matches the CHECK constraint. */
export const MAX_WORKOUT_CATEGORIES = 4;

const BY_KEY = new Map<string, WorkoutCategory>(
  WORKOUT_CATEGORIES.map((category) => [category.key, category]),
);

export function isWorkoutCategoryKey(value: string): value is WorkoutCategoryKey {
  return BY_KEY.has(value);
}

export function workoutCategory(key: string): WorkoutCategory | null {
  return BY_KEY.get(key) ?? null;
}

/** Drops anything not in the catalogue, so a stale stored value cannot crash a screen. */
export function knownCategories(keys: readonly string[] | null | undefined): WorkoutCategory[] {
  return (keys ?? []).flatMap((key) => {
    const category = BY_KEY.get(key);
    return category ? [category] : [];
  });
}

/**
 * Muscle groups covered by a selection.
 *
 * Returns null for "everything", which is different from an empty set: Full Body
 * must not filter the library down to nothing. Callers treat null as "no filter".
 */
export function musclesForCategories(keys: readonly string[]): MuscleGroup[] | null {
  const categories = knownCategories(keys);
  if (categories.length === 0) return null;

  // A single unrestricted category (Full Body) opens the whole library
  // even when combined with others — the broader intent wins, because a member
  // who picked Full Body should never find an exercise missing.
  if (categories.some((category) => category.muscles.length === 0)) return null;

  const muscles = new Set<MuscleGroup>();
  for (const category of categories) {
    for (const muscle of category.muscles) muscles.add(muscle);
  }
  return Array.from(muscles);
}

/**
 * Human label for a selection: "Chest + Triceps", "Legs", "Full Body".
 *
 * Falls back to a supplied inferred label so a session logged before workout types
 * existed still reads as something. Never returns an empty string.
 */
export function describeCategories(
  keys: readonly string[] | null | undefined,
  fallback = 'Workout',
): string {
  const categories = knownCategories(keys);
  if (categories.length === 0) return fallback;
  return categories.map((category) => category.label).join(' + ');
}

/**
 * A single emoji for a selection, for history rows and activity lines.
 *
 * The first category's emoji rather than all of them: "💪 🔻 Chest + Triceps"
 * turns a scannable list into a pictogram puzzle.
 */
export function categoryEmoji(keys: readonly string[] | null | undefined, fallback = '🏋️'): string {
  return knownCategories(keys)[0]?.emoji ?? fallback;
}

/**
 * Infers a label for a session that has no stored categories.
 *
 * This is what keeps existing history working after the schema change. Sessions
 * logged before `workout_categories` existed carry an empty array, so their type
 * is reconstructed from the muscle groups they actually trained — and it is
 * labelled as inferred wherever the distinction matters, because a guess about the
 * past should not masquerade as a choice the member made.
 *
 * Returns null when there is nothing to go on (a session with no exercises), so
 * callers can say "Workout" rather than inventing a muscle group.
 */
export function inferCategoriesFromMuscles(
  muscles: readonly (MuscleGroup | null | undefined)[],
): WorkoutCategoryKey[] {
  const present = new Set(muscles.filter((muscle): muscle is MuscleGroup => Boolean(muscle)));
  if (present.size === 0) return [];

  if (present.has('full_body')) return ['full_body'];

  // Broad categories only: a session with quads and hamstrings is "Legs", not
  // "Quads + Hamstrings".
  //
  // Scanned in the order the resulting LABEL should read, not alphabetically or in
  // catalogue order. People say "Chest + Arms" and "Back + Arms", never "Arms +
  // Chest", so the compound muscle group comes last.
  const broad: WorkoutCategoryKey[] = [];
  for (const key of ['chest', 'back', 'shoulders', 'legs', 'core', 'cardio', 'arms'] as const) {
    const category = BY_KEY.get(key);
    if (!category) continue;
    if (category.muscles.some((muscle) => present.has(muscle))) broad.push(key);
  }

  if (broad.length === 0) return [];
  // Four or more distinct areas in one session is a full-body day by any
  // reasonable reading, and a four-part label is unreadable in a list row.
  if (broad.length > 3) return ['full_body'];
  return broad;
}

/**
 * The categories to display for a session, stored ones preferred.
 *
 * One helper so every surface — history list, session detail, activity line —
 * agrees about what a session was, including for legacy rows.
 */
export function sessionCategoryKeys(
  stored: readonly string[] | null | undefined,
  exerciseMuscles: readonly (MuscleGroup | null | undefined)[] = [],
): { keys: WorkoutCategoryKey[]; inferred: boolean } {
  const known = knownCategories(stored);
  if (known.length > 0) {
    return { keys: known.map((category) => category.key), inferred: false };
  }
  return { keys: inferCategoriesFromMuscles(exerciseMuscles), inferred: true };
}
