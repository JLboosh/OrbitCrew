import {
  MAX_WORKOUT_CATEGORIES,
  WORKOUT_CATEGORIES,
  categoryEmoji,
  describeCategories,
  inferCategoriesFromMuscles,
  isWorkoutCategoryKey,
  knownCategories,
  musclesForCategories,
  sessionCategoryKeys,
} from '@/lib/workoutTypes';

/**
 * The taxonomy is the contract between the workout picker, the exercise filter, and
 * the CHECK constraint on `sessions.workout_categories`. These tests pin the three
 * behaviours the rest of the flow depends on: what a category expands to, what a
 * selection is called, and what a session logged before workout types existed looks
 * like.
 */

describe('category catalogue', () => {
  it('keeps every key within the vocabulary the CHECK constraint allows', () => {
    // Mirrors sessions_workout_categories_valid. If these diverge, a member picks a
    // workout type and the insert fails with a constraint violation.
    // Note this is a SUPERSET: 'custom' is still permitted by the constraint but
    // is no longer offered by the product. The assertion below is one-directional
    // on purpose — every catalogue key must be allowed, not the reverse.
    const allowed = [
      'legs',
      'arms',
      'chest',
      'back',
      'shoulders',
      'core',
      'cardio',
      'full_body',
      'custom',
      'quads',
      'hamstrings',
      'glutes',
      'calves',
      'biceps',
      'triceps',
      'forearms',
    ];

    for (const category of WORKOUT_CATEGORIES) {
      expect(allowed).toContain(category.key);
    }
  });

  it('has no duplicate keys', () => {
    const keys = WORKOUT_CATEGORIES.map((category) => category.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('recognises only real keys', () => {
    expect(isWorkoutCategoryKey('legs')).toBe(true);
    expect(isWorkoutCategoryKey('leg_day')).toBe(false);
  });

  it('drops unknown keys rather than crashing on stale stored data', () => {
    expect(knownCategories(['chest', 'not_a_category', 'triceps']).map((c) => c.key)).toEqual([
      'chest',
      'triceps',
    ]);
    expect(knownCategories(null)).toEqual([]);
  });
});

describe('musclesForCategories', () => {
  it('expands a training day into the muscle groups behind it', () => {
    expect(musclesForCategories(['legs'])).toEqual(
      expect.arrayContaining(['quads', 'hamstrings', 'glutes', 'calves']),
    );
  });

  it('combines a broad and a narrow category, which is what makes Chest + Triceps work', () => {
    const muscles = musclesForCategories(['chest', 'triceps']);
    expect(muscles).toEqual(expect.arrayContaining(['chest', 'triceps']));
    expect(muscles).toHaveLength(2);
  });

  it('deduplicates overlapping selections', () => {
    expect(musclesForCategories(['legs', 'quads'])).toHaveLength(4);
  });

  it('returns null for Full Body, meaning "do not filter" rather than "nothing"', () => {
    // A filter that matched nothing would leave the exercise list empty, which is
    // the opposite of what Full Body promises.
    expect(musclesForCategories(['full_body'])).toBeNull();
    expect(musclesForCategories([])).toBeNull();
  });

  it('lets the broader intent win when Full Body is combined with a muscle group', () => {
    expect(musclesForCategories(['full_body', 'chest'])).toBeNull();
  });
});

describe('describeCategories', () => {
  it('joins a split the way people say it', () => {
    expect(describeCategories(['chest', 'triceps'])).toBe('Chest + Triceps');
    expect(describeCategories(['back', 'biceps'])).toBe('Back + Biceps');
  });

  it('names a single day plainly', () => {
    expect(describeCategories(['legs'])).toBe('Legs');
  });

  it('falls back rather than returning an empty label', () => {
    expect(describeCategories([], 'Workout')).toBe('Workout');
    expect(describeCategories(undefined, 'Workout')).toBe('Workout');
  });
});

describe('categoryEmoji', () => {
  it('uses one emoji for a combination, not a pictogram puzzle', () => {
    expect(categoryEmoji(['chest', 'triceps'])).toBe('🫀');
  });

  it('falls back for an unlabelled session', () => {
    expect(categoryEmoji([], '🏋️')).toBe('🏋️');
  });
});

describe('inferCategoriesFromMuscles', () => {
  it('describes a leg session as Legs rather than four separate muscles', () => {
    expect(inferCategoriesFromMuscles(['quads', 'hamstrings', 'calves'])).toEqual(['legs']);
  });

  it('reconstructs a push split from the exercises that were logged', () => {
    // Reads the way people say it: "Chest + Arms", never "Arms + Chest".
    expect(inferCategoriesFromMuscles(['chest', 'triceps'])).toEqual(['chest', 'arms']);
    expect(inferCategoriesFromMuscles(['triceps', 'chest'])).toEqual(['chest', 'arms']);
  });

  it('puts the compound area last regardless of exercise order', () => {
    expect(inferCategoriesFromMuscles(['biceps', 'back'])).toEqual(['back', 'arms']);
  });

  it('calls four or more distinct areas a full-body day', () => {
    // Also keeps the label from becoming "Chest + Back + Legs + Core", which does
    // not fit in a history row.
    expect(inferCategoriesFromMuscles(['chest', 'back', 'quads', 'core'])).toEqual(['full_body']);
  });

  it('trusts an explicit full_body exercise', () => {
    expect(inferCategoriesFromMuscles(['full_body', 'chest'])).toEqual(['full_body']);
  });

  it('returns nothing when there is nothing to go on', () => {
    expect(inferCategoriesFromMuscles([])).toEqual([]);
    expect(inferCategoriesFromMuscles([null, undefined])).toEqual([]);
  });
});

describe('sessionCategoryKeys', () => {
  it('prefers what the member actually chose', () => {
    const result = sessionCategoryKeys(['chest', 'triceps'], ['back']);
    expect(result).toEqual({ keys: ['chest', 'triceps'], inferred: false });
  });

  it('infers from exercises for a session logged before workout types existed', () => {
    // This is what keeps historical data working after the migration: an empty
    // array is not a broken row, it is an older one.
    const result = sessionCategoryKeys([], ['quads', 'hamstrings']);
    expect(result).toEqual({ keys: ['legs'], inferred: true });
  });

  it('marks an inferred label as inferred so the UI never presents a guess as a choice', () => {
    expect(sessionCategoryKeys(null, ['chest']).inferred).toBe(true);
  });
});

describe('the selection cap', () => {
  it('matches the four allowed by the CHECK constraint', () => {
    expect(MAX_WORKOUT_CATEGORIES).toBe(4);
  });
});
