import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  useActiveSession,
  useCheckIn,
  useMyPresence,
  useMyProfile,
  useNearbyGyms,
  useStartSession,
  type NearbyGym,
} from '@/api';
import { Button, Card, Screen, SectionHeader, Text } from '@/components/ui';
import { WorkoutTypePicker } from '@/components/workouts';
import { CAMPUS_CENTRE } from '@/lib/campus';
import { useDeviceLocation } from '@/lib/deviceLocation';
import { errorMessage } from '@/lib/errors';
import { distanceSystemForWeightUnit, formatDistance } from '@/lib/geo';
import { describeCategories, type WorkoutCategoryKey } from '@/lib/workoutTypes';
import { useTheme } from '@/theme';

/**
 * Starting a workout: WHERE, then WHAT.
 *
 * WHY THE GYM IS ASKED FOR FIRST, AND WHY IT IS NOT OPTIONAL
 * ---------------------------------------------------------
 * Two different things record a gym, and only one of them puts a member on the
 * map:
 *
 *   * `sessions.gym_id` is a label on the workout. It is what the history and the
 *     crew feed read, and it is a snapshot taken when the session starts.
 *   * `presence` is what the map reads. A green marker shows friends' avatars
 *     because those members have a live `presence` row pointing at that gym.
 *
 * Previously this screen silently inferred the gym from an existing check-in and
 * created a session with `gym_id = null` when there was none. So a member who
 * started a workout without checking in first was invisible on the map and their
 * workout was unattributed — with nothing on screen explaining why. Asking once,
 * here, fixes both: the answer is written to the session AND used to check in, so
 * "I am training at the PAC" is stated a single time and both systems agree.
 *
 * "Not at a gym" is a first-class answer rather than a way to skip the question.
 * `sessions.gym_id` is nullable precisely because home and outdoor workouts are
 * real, and forcing a gym would either lose those sessions or produce false
 * presence at a gym the member is nowhere near. What is no longer possible is
 * starting a workout without having been asked.
 */
export default function NewWorkoutScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { gymId } = useLocalSearchParams<{ gymId?: string }>();

  const { data: activeSession } = useActiveSession();
  const { data: presence } = useMyPresence();
  const { data: profile } = useMyProfile();
  const location = useDeviceLocation();

  const startSession = useStartSession();
  const checkIn = useCheckIn();

  const [choice, setChoice] = useState<GymChoice | null>(null);
  const [selected, setSelected] = useState<WorkoutCategoryKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const distanceSystem = distanceSystemForWeightUnit(profile?.weight_unit ?? 'lb');

  // Campus rather than nothing when location is not granted: the member still gets
  // a usable list, and the map already opens there for the same reason.
  const origin = location.coords ?? CAMPUS_CENTRE;
  const nearby = useNearbyGyms(origin, 5000, 25);

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

  const gyms = nearby.data ?? [];

  /**
   * The answer that is already known, if any.
   *
   * A `?gymId=` param (arriving from a gym page or from adding a gym) wins, then
   * an existing check-in. Either way the member is not asked again — they have
   * already told us where they are.
   */
  const knownGymId = gymId ?? presence?.gym_id ?? null;
  const knownGym = knownGymId ? (gyms.find((gym) => gym.id === knownGymId) ?? null) : null;

  const effectiveChoice: GymChoice | null =
    choice ??
    (knownGymId
      ? {
          kind: 'gym',
          gymId: knownGymId,
          name: knownGym?.name ?? presence?.gym?.name ?? 'your gym',
        }
      : null);

  const answered = effectiveChoice !== null;

  const start = async () => {
    if (!effectiveChoice || selected.length === 0) return;
    setError(null);

    const chosenGymId = effectiveChoice.kind === 'gym' ? effectiveChoice.gymId : null;

    try {
      const session = await startSession.mutateAsync({
        gymId: chosenGymId,
        workoutCategories: selected,
      });

      // Check in only when a gym was chosen, and only when not already checked in
      // THERE — re-checking in at the same gym would reset the expiry for no
      // reason. Attaching the session id is what lets ending the workout clear
      // presence automatically, so nobody is left showing at a gym they left.
      if (chosenGymId && presence?.gym_id !== chosenGymId) {
        try {
          await checkIn.mutateAsync({ gymId: chosenGymId, sessionId: session.id });
        } catch {
          // The workout exists and is the thing the member asked for. Failing to
          // announce presence is a lesser problem than losing the session, so it
          // is not surfaced as a start failure — they can check in from the gym
          // page.
        }
      }

      router.replace('/session/active');
    } catch (err) {
      setError(errorMessage(err, 'Could not start the workout. Please try again.'));
    }
  };

  return (
    <Screen title="Start a workout" subtitle="Where you are, then what you are training.">
      {/* ------------------------------------------------------------------
          Step 1 — where.
          ------------------------------------------------------------------ */}
      <Card>
        <SectionHeader title="1. Where are you training?" />

        {answered ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="subheading" tone="primary">
              {effectiveChoice.kind === 'gym' ? effectiveChoice.name : 'Not at a gym'}
            </Text>
            <Text variant="caption" tone="muted">
              {effectiveChoice.kind === 'gym'
                ? 'Your crew will see you here while you train. Presence ends automatically when you finish.'
                : 'This workout still counts. Nothing is shared, because there is no gym to share.'}
            </Text>
            <Button
              label="Change"
              variant="ghost"
              onPress={() => {
                setChoice(null);
                // Clearing the param too, otherwise the known gym immediately
                // re-answers the question the member just reopened.
                router.setParams({ gymId: undefined });
              }}
            />
          </View>
        ) : (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              Pick the gym you are at so your crew can see you there, and so this workout is
              attributed to the right place.
            </Text>

            {location.supported && location.coords === null ? (
              <Button
                label="Use my location to sort by distance"
                variant="secondary"
                loading={location.status === 'requesting'}
                onPress={() => void location.request()}
              />
            ) : null}

            {nearby.isLoading ? (
              <Text variant="caption" tone="muted">
                Finding gyms near you…
              </Text>
            ) : nearby.isError ? (
              <>
                <Text variant="caption" tone="danger">
                  Could not load nearby gyms.
                </Text>
                <Button label="Try again" variant="secondary" onPress={() => nearby.refetch()} />
              </>
            ) : gyms.length === 0 ? (
              <Text variant="caption" tone="muted">
                No gyms found nearby. Add the one you are at, or carry on without a gym.
              </Text>
            ) : (
              <View>
                {gyms.slice(0, 8).map((gym) => (
                  <GymOption
                    key={gym.id}
                    gym={gym}
                    distanceLabel={formatDistance(gym.distance_metres, distanceSystem)}
                    onPress={() => setChoice({ kind: 'gym', gymId: gym.id, name: gym.name })}
                  />
                ))}
              </View>
            )}

            <View style={[styles.actions, { gap: theme.spacing.sm }]}>
              {/* Returns here rather than to the new gym's page, so adding a
                  missing gym does not abandon the workout being started. */}
              <Button
                label="My gym is not listed"
                variant="secondary"
                icon="add"
                onPress={() =>
                  router.push(
                    `/gym/new?lat=${origin.latitude}&lng=${origin.longitude}&next=session`,
                  )
                }
              />
              <Button
                label="Not at a gym"
                variant="ghost"
                onPress={() => setChoice({ kind: 'none' })}
              />
            </View>
          </View>
        )}
      </Card>

      {/* ------------------------------------------------------------------
          Step 2 — what. Revealed only once step 1 is answered, so the order is
          unmistakable and the Start button is never reachable unanswered.
          ------------------------------------------------------------------ */}
      {answered ? (
        <>
          <Card>
            <SectionHeader title="2. What are you training?" />
            <WorkoutTypePicker selected={selected} onChange={setSelected} />
          </Card>

          <Button
            label={selected.length > 0 ? `Start ${describeCategories(selected)}` : 'Start workout'}
            icon="play"
            size="large"
            fullWidth
            disabled={selected.length === 0}
            loading={startSession.isPending || checkIn.isPending}
            onPress={start}
          />
        </>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
    </Screen>
  );
}

/** Where the member says they are. `none` is an answer, not a missing one. */
type GymChoice = { kind: 'gym'; gymId: string; name: string } | { kind: 'none' };

function GymOption({
  gym,
  distanceLabel,
  onPress,
}: {
  gym: NearbyGym;
  distanceLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${gym.name}, ${distanceLabel} away`}
      style={({ pressed }) => [
        styles.option,
        {
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={1}>
          {gym.name}
        </Text>
        {gym.address ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {gym.address}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="subtle">
        {distanceLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
