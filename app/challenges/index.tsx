import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { isDailyChallenge, useMyChallenges, useVisibleCrewChallenges, type Challenge } from '@/api';
import { ChallengeCard, DailyChallengeCard } from '@/components/challenges';
import { Button, Card, Screen, Text } from '@/components/ui';
import { challengeStatus } from '@/lib/challengeRules';
import { useTheme } from '@/theme';

/**
 * Challenges — everything the member is in, plus what they could join.
 *
 * Three groups, in the order they matter: what is running now, what is open in
 * their crews, and what has finished. Finished ones are kept rather than hidden,
 * because a completed challenge is a record of something achieved.
 */
export default function ChallengesScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: mine, isLoading } = useMyChallenges();
  const { data: crewChallenges } = useVisibleCrewChallenges();

  const joined = mine ?? [];
  const joinedIds = new Set(joined.map((entry) => entry.challenge_id));

  /**
   * Daily challenges are excluded from these lists and given their own card.
   *
   * There is one per member per day, so after a fortnight they would be the entire
   * "Finished" section and would push every real challenge off the screen. The card
   * at the top shows today's plus a seven-day recap, which is all of that
   * information in a tenth of the space.
   */
  const withChallenge = joined.flatMap((entry) =>
    entry.challenge && !isDailyChallenge(entry.challenge)
      ? [{ challenge: entry.challenge, participation: entry }]
      : [],
  );

  const active = withChallenge
    .filter(({ challenge }) => challengeStatus(challenge.starts_at, challenge.ends_at) !== 'ended')
    .sort((a, b) => Date.parse(a.challenge.ends_at) - Date.parse(b.challenge.ends_at));

  const finished = withChallenge
    .filter(({ challenge }) => challengeStatus(challenge.starts_at, challenge.ends_at) === 'ended')
    .sort((a, b) => Date.parse(b.challenge.ends_at) - Date.parse(a.challenge.ends_at));

  // Crew challenges the member can see but has not joined. Participation is
  // always opt-in, so these are invitations rather than assignments.
  const joinable = (crewChallenges ?? [])
    .filter((challenge) => !joinedIds.has(challenge.id))
    .filter((challenge) => challengeStatus(challenge.starts_at, challenge.ends_at) !== 'ended');

  const openChallenge = (challenge: Challenge) => router.push(`/challenges/${challenge.id}`);

  return (
    <Screen title="Challenges" subtitle="Small commitments, kept visible.">
      <DailyChallengeCard
        onOpen={() => router.push('/challenges/daily')}
        onStartWorkout={() => router.push('/session/new')}
      />

      <Button
        label="Start a challenge"
        size="large"
        fullWidth
        onPress={() => router.push('/challenges/new')}
      />

      {isLoading ? (
        <Card>
          <Text variant="caption" tone="muted">
            Loading…
          </Text>
        </Card>
      ) : null}

      {active.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading" heading>
            Running now
          </Text>
          {active.map(({ challenge, participation }) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              progress={Number(participation.progress)}
              completedAt={participation.completed_at}
              onPress={openChallenge}
            />
          ))}
        </View>
      ) : null}

      {joinable.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading" heading>
            Open in your crews
          </Text>
          {joinable.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              progress={null}
              onPress={openChallenge}
            />
          ))}
        </View>
      ) : null}

      {!isLoading && active.length === 0 && joinable.length === 0 ? (
        <Card>
          <Text variant="subheading">Nothing else running</Text>
          <Text variant="caption" tone="muted">
            Beyond today&apos;s challenge above, a challenge is a nudge you choose rather than a
            target someone sets for you. Consistency over four weeks is a good first one.
          </Text>
        </Card>
      ) : null}

      {finished.length > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading" heading>
            Finished
          </Text>
          {finished.slice(0, 10).map(({ challenge, participation }) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              progress={Number(participation.progress)}
              completedAt={participation.completed_at}
              onPress={openChallenge}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
