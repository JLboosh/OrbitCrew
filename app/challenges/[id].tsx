import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  combinedProgress,
  useChallenge,
  useChallengeParticipants,
  useCrew,
  useDeleteChallenge,
  useExercises,
  useJoinChallenge,
  useLeaveChallenge,
  useMyChallenges,
  useMyCrews,
  useRescoreChallenge,
} from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import {
  challengeStatus,
  daysRemaining,
  describeChallengeRule,
  describeQualification,
  formatChallengeProgress,
  isCombinedProgress,
  isTimezoneSensitive,
  parseChallengeRule,
  type ChallengeStatus,
} from '@/lib/challengeRules';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

/**
 * Challenge detail — progress, who else is in, and how it is scored.
 *
 * TRANSPARENCY IS THE POINT OF THIS SCREEN. A member who trained but saw no
 * movement needs to know why, so it states the qualifying rule (finished sessions
 * over the crew's minimum duration), the timezone used for time-of-day rules, and
 * the exact window. Progress that cannot be explained is progress nobody trusts.
 *
 * The number itself always comes from `challenge_participants.progress`, computed
 * by `score_challenge_for_user()`. This screen never counts sessions.
 */
export default function ChallengeDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const { data: challenge, isLoading } = useChallenge(id);
  const { data: participants } = useChallengeParticipants(id);
  const { data: mine } = useMyChallenges();
  const { data: crews } = useMyCrews();
  const { data: exercises } = useExercises();
  const { data: crew } = useCrew(challenge?.crew_id ?? undefined);

  const join = useJoinChallenge();
  const leave = useLeaveChallenge();
  const rescore = useRescoreChallenge();
  const remove = useDeleteChallenge();

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Progress is a cache that nothing refreshes when a session ends, so a single
  // idempotent rescore on open is what makes this screen show the truth. Guarded
  // by a ref so it runs once per mount rather than on every render.
  const rescored = useRef(false);
  useEffect(() => {
    if (!challenge || rescored.current) return;
    rescored.current = true;
    rescore.mutate({ id: challenge.id, crew_id: challenge.crew_id });
    // `rescore` is a stable mutation object; including it would re-run this on
    // every state change it publishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  if (isLoading) {
    return (
      <Screen title="Challenge">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  if (!challenge) {
    return (
      <Screen title="Challenge">
        <Card>
          <Text variant="subheading">Not available</Text>
          <Text variant="caption" tone="muted">
            This challenge either does not exist or belongs to a crew you are not in.
          </Text>
        </Card>
      </Screen>
    );
  }

  const participation = (mine ?? []).find((entry) => entry.challenge_id === challenge.id) ?? null;
  const joined = participation !== null;

  const target = Number(challenge.target);
  const combined = isCombinedProgress(challenge.rule_type);
  const everyone = participants ?? [];

  // A crew total is judged on the group's combined progress, which is how the
  // engine decides completion. Showing an individual figure would contradict it.
  const shownProgress = combined
    ? combinedProgress(everyone)
    : Number(participation?.progress ?? 0);

  const completed = combined
    ? shownProgress >= target
    : participation?.completed_at != null || shownProgress >= target;

  const status = challengeStatus(challenge.starts_at, challenge.ends_at);
  const rule = parseChallengeRule(challenge.rule);
  const exerciseName = rule.exerciseId
    ? (exercises?.find((exercise) => exercise.id === rule.exerciseId)?.name ?? null)
    : null;

  const isCrewAdmin = (crews ?? []).some(
    (entry) =>
      entry.crew?.id === challenge.crew_id && (entry.role === 'owner' || entry.role === 'admin'),
  );
  const canDelete = challenge.owner_id === user?.id || isCrewAdmin;

  const badgePrefix = challenge.badge_emoji ? `${challenge.badge_emoji} ` : '';
  const subtitle =
    challenge.scope === 'crew' ? (crew?.name ?? 'Crew challenge') : 'Personal challenge';

  return (
    <Screen title={`${badgePrefix}${challenge.name}`} subtitle={subtitle}>
      {/* What it asks for, and where the member stands. */}
      <Card>
        <Text variant="body">
          {describeChallengeRule(challenge.rule_type, challenge.rule, target, exerciseName)}
        </Text>

        <ProgressBar
          label={combined ? 'Crew combined progress' : 'Your progress'}
          value={shownProgress}
          target={target}
          showCounts={false}
        />

        <View style={styles.row}>
          <Text variant="subheading" tone={completed ? 'success' : 'default'}>
            {formatChallengeProgress(challenge.rule_type, shownProgress, target)}
          </Text>
          <Text variant="caption" tone={completed ? 'success' : 'muted'}>
            {timingLabel(status, challenge.ends_at, completed)}
          </Text>
        </View>

        {combined ? (
          <Text variant="caption" tone="subtle">
            Everyone taking part finishes together when the crew reaches the target.
          </Text>
        ) : null}

        {!joined && status !== 'ended' ? (
          <Button
            label="Join this challenge"
            size="large"
            fullWidth
            loading={join.isPending}
            onPress={() => join.mutate({ id: challenge.id, crew_id: challenge.crew_id })}
          />
        ) : null}

        {join.isError ? (
          <Text variant="caption" tone="danger">
            {errorMessage(join.error, 'Could not join. Please try again.')}
          </Text>
        ) : null}
      </Card>

      {/* How it is scored. Stated plainly so unexplained progress never happens. */}
      <Card>
        <Text variant="subheading" heading>
          How this is scored
        </Text>
        <Text variant="caption" tone="muted">
          {describeQualification(crew?.min_session_minutes)}
        </Text>
        <Text variant="caption" tone="muted">
          {formatWindow(challenge.starts_at, challenge.ends_at)}
        </Text>
        {isTimezoneSensitive(challenge.rule_type) ? (
          <Text variant="caption" tone="muted">
            Times are judged in {challenge.timezone}
            {challenge.scope === 'crew' ? ", your crew's timezone" : ''}, so everyone is measured
            against the same clock.
          </Text>
        ) : null}
        {challenge.rule_type === 'exercise_1rm_gain' ? (
          <Text variant="caption" tone="muted">
            Measured against your best estimated one-rep max before the challenge began, so earlier
            progress does not count toward it.
          </Text>
        ) : null}
        <Button
          label="Refresh progress"
          variant="ghost"
          loading={rescore.isPending}
          onPress={() => rescore.mutate({ id: challenge.id, crew_id: challenge.crew_id })}
        />
      </Card>

      {/* Participants. Only ever the member alone for a personal challenge, which
          is the RLS policy doing its job rather than a bug. */}
      {challenge.scope === 'crew' && everyone.length > 0 ? (
        <Card>
          <Text variant="subheading" heading>
            Taking part
          </Text>
          {everyone.map((entry) => (
            <View key={entry.user_id} style={[styles.row, { paddingVertical: theme.spacing.xs }]}>
              <Text variant="body" numberOfLines={1} style={styles.name}>
                {entry.user_id === user?.id ? 'You' : (entry.profile?.display_name ?? 'Member')}
              </Text>
              <Text variant="caption" tone={entry.completed_at ? 'success' : 'muted'}>
                {formatChallengeProgress(challenge.rule_type, Number(entry.progress), target)}
                {entry.completed_at ? ' · done' : ''}
              </Text>
            </View>
          ))}
          <Text variant="caption" tone="subtle">
            Ranked by challenge contribution, never by weight lifted or time spent.
          </Text>
        </Card>
      ) : null}

      {/* Leaving and deleting. Both are quiet, undramatic actions. */}
      {joined ? (
        <Button
          label="Leave challenge"
          variant="ghost"
          loading={leave.isPending}
          onPress={() => leave.mutate({ id: challenge.id, crew_id: challenge.crew_id })}
        />
      ) : null}

      {canDelete ? (
        <Card>
          <Text variant="caption" tone="muted">
            {challenge.scope === 'crew'
              ? 'As an admin you can delete this challenge for the whole crew.'
              : 'You can delete this challenge.'}
          </Text>
          {confirmingDelete ? (
            <View style={[styles.actions, { gap: theme.spacing.sm }]}>
              <Button
                label="Delete for good"
                variant="danger"
                loading={remove.isPending}
                onPress={async () => {
                  try {
                    await remove.mutateAsync({ id: challenge.id, crew_id: challenge.crew_id });
                    router.replace('/challenges');
                  } catch {
                    setConfirmingDelete(false);
                  }
                }}
              />
              <Button label="Keep it" variant="ghost" onPress={() => setConfirmingDelete(false)} />
            </View>
          ) : (
            <Button
              label="Delete challenge"
              variant="ghost"
              onPress={() => setConfirmingDelete(true)}
            />
          )}
          {remove.isError ? (
            <Text variant="caption" tone="danger">
              {errorMessage(remove.error, 'Could not delete the challenge.')}
            </Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function timingLabel(status: ChallengeStatus, endsAt: string, completed: boolean): string {
  if (completed) return 'Complete';
  if (status === 'ended') return 'Ended';
  if (status === 'upcoming') return 'Not started yet';

  const days = daysRemaining(endsAt);
  return days <= 0 ? 'Ends today' : `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function formatWindow(startsAt: string, endsAt: string): string {
  const format = (value: string) =>
    new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  return `${format(startsAt)} to ${format(endsAt)}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
