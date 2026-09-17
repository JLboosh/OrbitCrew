import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  useDeleteSet,
  useLogSet,
  useRemoveSessionExercise,
  useUpdateSessionExerciseNotes,
  useUpdateSet,
  type SessionDetail,
  type SetRow,
  type WeightUnit,
} from '@/api';
import { Button, Text, TextField } from '@/components/ui';
import { defaultSetValues, setFieldsFor } from '@/lib/exerciseEntry';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

type Entry = SessionDetail['session_exercises'][number];

export interface ExerciseBlockProps {
  entry: Entry;
  preferredUnit: WeightUnit;
}

/**
 * One exercise in the active workout: its sets, and the controls to change them.
 *
 * WHY SETS ARE EDITABLE ROWS RATHER THAN A FORM PLUS A LOG BUTTON
 * --------------------------------------------------------------
 * The old screen showed, per exercise, a list of finished sets AND a separate
 * weight/reps/warm-up entry row AND a "Log set" button — five controls before
 * anything was logged, repeated for every exercise, which is what made the screen
 * feel like a spreadsheet. Here "+ Add set" writes the row immediately, pre-filled
 * from the set before it, and the two numbers are corrected in place. Consecutive
 * sets usually repeat, so the common case is now one tap per set and no typing at
 * all.
 *
 * Values are saved on blur rather than on every keystroke: a request per character
 * would be wasteful on gym wifi, and a half-typed "1" from "135" is a number the
 * database would briefly believe.
 */
export function ExerciseBlock({ entry, preferredUnit }: ExerciseBlockProps) {
  const theme = useTheme();

  const logSet = useLogSet();
  const removeExercise = useRemoveSessionExercise();
  const updateNotes = useUpdateSessionExerciseNotes();

  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(() => Boolean(entry.notes));
  const [notes, setNotes] = useState(entry.notes ?? '');

  const sets = [...entry.sets].sort((a, b) => a.set_index - b.set_index);
  const lastSet = sets[sets.length - 1];
  const exercise = entry.exercise;
  const fields = setFieldsFor(exercise);
  const name = exercise?.name ?? 'Exercise';

  const addSet = async () => {
    setError(null);
    const defaults = defaultSetValues(exercise);

    try {
      await logSet.mutateAsync({
        sessionExerciseId: entry.id,
        setIndex: sets.length,
        // Carried over from the previous set, which is what makes adding a
        // fourth set of the same thing a single tap.
        weight: lastSet ? lastSet.weight : defaults.weight,
        weightUnit: preferredUnit,
        reps: lastSet ? lastSet.reps : defaults.reps,
        durationSeconds: lastSet ? lastSet.duration_seconds : defaults.durationSeconds,
        // Warm-up is a per-set decision and never inherited: inheriting it would
        // quietly exclude working sets from volume and personal records.
        isWarmup: false,
      });
    } catch (err) {
      setError(errorMessage(err, 'Could not add that set.'));
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.header}>
        <View style={styles.title}>
          <Text variant="subheading" heading numberOfLines={2}>
            {name}
          </Text>
          {/* Visible AND accessible: it gives a screen-reader user the shape of
              the block before they step through six editable fields, and it gives
              everyone else the number they actually care about between sets. */}
          <Text variant="caption" tone="subtle">
            {summariseSets(sets, preferredUnit)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from this workout`}
          hitSlop={10}
          onPress={() => removeExercise.mutate(entry.id)}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="caption" tone="muted">
            Remove
          </Text>
        </Pressable>
      </View>

      {sets.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {sets.map((set, setIndex) => (
            /*
             * The key carries the SERVER VALUES, not just the id.
             *
             * The row holds the two numbers in local state so typing is smooth, and
             * that state has to be re-seeded when the stored value changes — after
             * our own save, or after an edit on another device. React's answer to
             * "reset state when a prop changes" is a new key, which is why there is
             * no synchronising effect here.
             *
             * Crucially the key does NOT change while someone is typing, because
             * nothing is written until blur. A background refetch that returns the
             * same values remounts nothing.
             */
            <SetRowEditor
              key={`${set.id}:${set.weight}:${set.reps}:${set.duration_seconds}`}
              set={set}
              number={setIndex + 1}
              fields={fields}
              preferredUnit={preferredUnit}
              exerciseName={name}
            />
          ))}
        </View>
      ) : null}

      <View style={[styles.actions, { gap: theme.spacing.sm }]}>
        <Button
          label="+ Add set"
          variant="quiet"
          size="small"
          loading={logSet.isPending}
          accessibilityLabel={`Add a set to ${name}`}
          accessibilityHint={lastSet ? 'Copies the weight and reps from your last set.' : undefined}
          onPress={addSet}
        />
        {!notesOpen ? (
          <Button
            label="+ Note"
            variant="ghost"
            size="small"
            accessibilityLabel={`Add a note to ${name}`}
            onPress={() => setNotesOpen(true)}
          />
        ) : null}
      </View>

      {notesOpen ? (
        <TextField
          label={`Notes for ${name}`}
          value={notes}
          onChangeText={setNotes}
          onBlur={() => {
            if ((entry.notes ?? '') === notes.trim()) return;
            updateNotes.mutate({ sessionExerciseId: entry.id, notes });
          }}
          placeholder="Belt on from set 3"
          maxLength={500}
          multiline
        />
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** One set: number, editable values, warm-up toggle, delete. */
function SetRowEditor({
  set,
  number,
  fields,
  preferredUnit,
  exerciseName,
}: {
  set: SetRow;
  number: number;
  fields: ReturnType<typeof setFieldsFor>;
  preferredUnit: WeightUnit;
  exerciseName: string;
}) {
  const theme = useTheme();
  const updateSet = useUpdateSet();
  const deleteSet = useDeleteSet();

  // Seeded from the row and re-seeded by a remount when the stored values change.
  // See the key on this component in `ExerciseBlock`.
  const [weight, setWeight] = useState(numberText(set.weight));
  const [reps, setReps] = useState(numberText(set.reps));
  const [minutes, setMinutes] = useState(
    set.duration_seconds == null ? '' : String(Math.round(set.duration_seconds / 60)),
  );

  const commit = (patch: Parameters<typeof updateSet.mutate>[0]) => {
    updateSet.mutate(patch);
  };

  return (
    <View
      style={[
        styles.setRow,
        {
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      <Text variant="caption" tone="subtle" style={styles.setNumber}>
        {number}
      </Text>

      {fields.weight ? (
        <TextField
          label={`Set ${number} weight in ${preferredUnit}`}
          labelHidden
          value={weight}
          onChangeText={setWeight}
          onBlur={() =>
            commit({
              setId: set.id,
              weight: parseNumber(weight),
              weightUnit: preferredUnit,
            })
          }
          keyboardType="decimal-pad"
          suffix={preferredUnit}
          placeholder="0"
        />
      ) : null}

      {fields.reps ? (
        <TextField
          label={`Set ${number} reps`}
          labelHidden
          value={reps}
          onChangeText={setReps}
          onBlur={() => commit({ setId: set.id, reps: parseNumber(reps) })}
          keyboardType="number-pad"
          suffix="reps"
          placeholder="0"
        />
      ) : null}

      {fields.duration ? (
        <TextField
          label={`Set ${number} duration in minutes`}
          labelHidden
          value={minutes}
          onChangeText={setMinutes}
          onBlur={() => {
            const value = parseNumber(minutes);
            commit({
              setId: set.id,
              durationSeconds: value === null ? null : Math.round(value * 60),
            });
          }}
          keyboardType="decimal-pad"
          suffix="min"
          placeholder="0"
        />
      ) : null}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.is_warmup }}
        accessibilityLabel={`Set ${number} of ${exerciseName} is a warm-up`}
        accessibilityHint="Warm-up sets are excluded from volume and personal records."
        hitSlop={8}
        onPress={() => commit({ setId: set.id, isWarmup: !set.is_warmup })}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="caption" tone={set.is_warmup ? 'accent' : 'subtle'}>
          {set.is_warmup ? 'W' : '—'}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete set ${number} of ${exerciseName}`}
        hitSlop={8}
        onPress={() => deleteSet.mutate(set.id)}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text variant="caption" tone="muted">
          ✕
        </Text>
      </Pressable>
    </View>
  );
}

function numberText(value: number | null): string {
  if (value == null) return '';
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Empty means "not recorded", which is a different fact from zero. */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * "3 sets · best 110 lb × 8", or a nudge when there are none.
 *
 * The best WORKING set, not the last one and not the heaviest including warm-ups —
 * that is the number that means something between sets, and it matches what the
 * personal-record trigger considers.
 */
function summariseSets(sets: SetRow[], unit: WeightUnit): string {
  const working = sets.filter((set) => !set.is_warmup);
  if (sets.length === 0) return 'Tap add set to start logging.';

  const count = `${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`;
  const best = working.reduce<SetRow | null>((leader, set) => {
    if (set.weight == null) return leader;
    if (leader?.weight == null) return set;
    return set.weight > leader.weight ? set : leader;
  }, null);

  if (!best || best.weight == null) return count;

  const reps = best.reps != null ? ` × ${best.reps}` : '';
  return `${count} · best ${best.weight} ${unit}${reps}`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setNumber: {
    width: 16,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
