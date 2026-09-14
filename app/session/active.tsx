import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';

import {
  useActiveSession,
  useAddSessionExercise,
  useDeleteSet,
  useEndSession,
  useExercises,
  useGym,
  useLogSet,
  useMyProfile,
  useRemoveSessionExercise,
  type SessionDetail,
} from '@/api';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Active session — capture the workout with as little friction as possible.
 *
 * Design constraints specific to this screen: it is used standing up, one-handed,
 * between sets, often with sweat on the screen. So touch targets are large, the
 * numeric keypad is used for weight and reps, and the previous set's values
 * pre-fill the next one, since sets are usually repeated.
 */
export default function ActiveSessionScreen() {
  const router = useRouter();

  const { data: session, isLoading } = useActiveSession();
  const { data: profile } = useMyProfile();
  const endSession = useEndSession();

  if (isLoading) {
    return (
      <Screen title="Session">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  if (!session) {
    return (
      <Screen title="No active session" subtitle="Start one from the Today screen.">
        <Button label="Back to Today" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }

  const preferredUnit = profile?.weight_unit ?? 'lb';

  return (
    <Screen title="Session">
      <Card>
        <ElapsedTimer startedAt={session.started_at} />
        <GymLine gymId={session.gym_id} />
        <Text variant="caption" tone="subtle">
          Sessions count toward your crew goal once they pass the crew&apos;s minimum length.
        </Text>
      </Card>

      {session.session_exercises
        ?.slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((entry) => (
          <ExerciseBlock
            key={entry.id}
            entry={entry}
            preferredUnit={preferredUnit}
            sessionId={session.id}
          />
        ))}

      <AddExercise sessionId={session.id} nextIndex={session.session_exercises?.length ?? 0} />

      <Button
        label="End session"
        size="large"
        fullWidth
        loading={endSession.isPending}
        onPress={() => {
          Alert.alert('End session?', 'Your logged sets are already saved.', [
            { text: 'Keep going', style: 'cancel' },
            {
              text: 'End session',
              onPress: async () => {
                await endSession.mutateAsync(session.id);
                router.replace('/(tabs)');
              },
            },
          ]);
        }}
      />
    </Screen>
  );
}

function GymLine({ gymId }: { gymId: string | null }) {
  const { data: gym } = useGym(gymId ?? undefined);
  if (!gymId) {
    return (
      <Text variant="caption" tone="muted">
        No gym selected
      </Text>
    );
  }
  return (
    <Text variant="caption" tone="muted">
      {gym?.name ?? 'Loading gym…'}
    </Text>
  );
}

/** One exercise plus its sets and the entry row for the next set. */
function ExerciseBlock({
  entry,
  preferredUnit,
  sessionId: _sessionId,
}: {
  entry: SessionDetail['session_exercises'][number];
  preferredUnit: 'lb' | 'kg';
  sessionId: string;
}) {
  const theme = useTheme();
  const logSet = useLogSet();
  const deleteSet = useDeleteSet();
  const removeExercise = useRemoveSessionExercise();

  const sets = useMemo(
    () => entry.sets.slice().sort((a, b) => a.set_index - b.set_index),
    [entry.sets],
  );
  const lastSet = sets[sets.length - 1];

  // Pre-fill from the previous set: consecutive sets usually repeat the same
  // weight and reps, so this removes most of the typing.
  const [weight, setWeight] = useState(() =>
    lastSet?.weight != null ? String(lastSet.weight) : '',
  );
  const [reps, setReps] = useState(() => (lastSet?.reps != null ? String(lastSet.reps) : ''));
  const [isWarmup, setIsWarmup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWeighted = entry.exercise?.is_weighted ?? true;
  const canLog = isWeighted ? weight.trim() !== '' || reps.trim() !== '' : reps.trim() !== '';

  const numericInput = {
    minHeight: theme.minTouchTarget,
    minWidth: 72,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    fontSize: 18,
    textAlign: 'center' as const,
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="subheading" heading>
          {entry.exercise?.name ?? 'Exercise'}
        </Text>
        <Button
          label="Remove"
          variant="ghost"
          onPress={() => removeExercise.mutate(entry.id)}
          accessibilityLabel={`Remove ${entry.exercise?.name ?? 'exercise'} from this session`}
        />
      </View>

      {/* Logged sets. */}
      {sets.length ? (
        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
          {sets.map((set, index) => (
            <View
              key={set.id}
              accessible
              accessibilityLabel={describeSet(set, index)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: theme.spacing.xs,
              }}
            >
              <Text variant="body" tone="subtle" style={{ width: 24 }}>
                {index + 1}
              </Text>
              <Text variant="body" style={{ flex: 1 }}>
                {formatSet(set)}
                {set.is_warmup ? '  ·  warm-up' : ''}
              </Text>
              {set.estimated_1rm_kg != null ? (
                <Text variant="caption" tone="subtle">
                  ~{formatWeight(Number(set.estimated_1rm_kg), preferredUnit)} 1RM
                </Text>
              ) : null}
              <Button
                label="✕"
                variant="ghost"
                accessibilityLabel={`Delete set ${index + 1}`}
                onPress={() => deleteSet.mutate(set.id)}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* Next set entry. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: theme.spacing.sm,
          marginTop: theme.spacing.md,
        }}
      >
        {isWeighted ? (
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              Weight ({preferredUnit})
            </Text>
            <TextInput
              value={weight}
              onChangeText={setWeight}
              accessibilityLabel={`Weight in ${preferredUnit}`}
              keyboardType="decimal-pad"
              style={numericInput}
            />
          </View>
        ) : null}

        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="muted">
            Reps
          </Text>
          <TextInput
            value={reps}
            onChangeText={setReps}
            accessibilityLabel="Repetitions"
            keyboardType="number-pad"
            style={numericInput}
          />
        </View>

        <Button
          label={isWarmup ? 'Warm-up' : 'Working'}
          variant="ghost"
          accessibilityLabel={
            isWarmup
              ? 'Marked as warm-up. Tap to mark as a working set.'
              : 'Marked as a working set. Tap to mark as warm-up.'
          }
          accessibilityState={{ selected: isWarmup }}
          onPress={() => setIsWarmup((v) => !v)}
        />
      </View>

      <Button
        label="Log set"
        fullWidth
        disabled={!canLog}
        loading={logSet.isPending}
        style={{ marginTop: theme.spacing.sm }}
        onPress={async () => {
          setError(null);
          try {
            await logSet.mutateAsync({
              sessionExerciseId: entry.id,
              setIndex: sets.length,
              weight: weight.trim() === '' ? null : Number(weight),
              weightUnit: preferredUnit,
              reps: reps.trim() === '' ? null : Number(reps),
              isWarmup,
            });
            // Warm-up is a per-set decision, so it resets; weight and reps stay
            // for the next set.
            setIsWarmup(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not log that set.');
          }
        }}
      />

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}

/** Exercise picker with a simple name filter. */
function AddExercise({ sessionId, nextIndex }: { sessionId: string; nextIndex: number }) {
  const theme = useTheme();
  const { data: exercises } = useExercises();
  const addExercise = useAddSessionExercise();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    if (!exercises) return [];
    const q = query.trim().toLowerCase();
    const pool = q ? exercises.filter((e) => e.name.toLowerCase().includes(q)) : exercises;
    return pool.slice(0, 12);
  }, [exercises, query]);

  if (!open) {
    return <Button label="Add exercise" size="large" fullWidth onPress={() => setOpen(true)} />;
  }

  return (
    <Card>
      <Text variant="subheading" heading>
        Add exercise
      </Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search exercises"
        placeholder="Search…"
        placeholderTextColor={theme.colors.textSubtle}
        autoFocus
        style={{
          minHeight: theme.minTouchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
          fontSize: 16,
          marginTop: theme.spacing.sm,
        }}
      />

      <View style={{ marginTop: theme.spacing.sm }}>
        {matches.map((exercise) => (
          <Button
            key={exercise.id}
            label={exercise.name}
            variant="ghost"
            fullWidth
            onPress={async () => {
              await addExercise.mutateAsync({
                sessionId,
                exerciseId: exercise.id,
                orderIndex: nextIndex,
              });
              setQuery('');
              setOpen(false);
            }}
          />
        ))}
        {matches.length === 0 ? (
          <Text variant="caption" tone="muted">
            No matches.
          </Text>
        ) : null}
      </View>

      <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
    </Card>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <Text variant="metric" accessibilityLabel={`Elapsed ${m} minutes ${s} seconds`}>
      {h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`}
    </Text>
  );
}

function formatSet(set: {
  weight: number | null;
  weight_unit: string;
  reps: number | null;
  duration_seconds: number | null;
}): string {
  if (set.duration_seconds != null) {
    return `${Math.round(set.duration_seconds / 60)} min`;
  }
  const parts: string[] = [];
  if (set.weight != null) parts.push(`${set.weight} ${set.weight_unit}`);
  if (set.reps != null) parts.push(`× ${set.reps}`);
  return parts.join(' ') || '—';
}

function describeSet(
  set: {
    weight: number | null;
    weight_unit: string;
    reps: number | null;
    is_warmup: boolean;
    duration_seconds: number | null;
  },
  index: number,
): string {
  return `Set ${index + 1}: ${formatSet(set)}${set.is_warmup ? ', warm-up' : ''}`;
}

/** Converts stored kilograms back to the member's preferred display unit. */
function formatWeight(kg: number, unit: 'lb' | 'kg'): string {
  if (unit === 'kg') return `${Math.round(kg)} kg`;
  return `${Math.round(kg / 0.45359237)} lb`;
}
