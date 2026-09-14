import { Pressable, StyleSheet, View } from 'react-native';

import { useMyChallenges, type Challenge } from '@/api';
import { Button, Card, ProgressBar, Text } from '@/components/ui';
import {
  challengeStatus,
  daysRemaining,
  formatChallengeProgress,
  isCombinedProgress,
} from '@/lib/challengeRules';
import { useTheme } from '@/theme';

export interface ActiveChallengesProps {
  /** How many to show before deferring to the full list. */
  limit?: number;
  onOpenChallenge?: (challengeId: string) => void;
  onSeeAll?: () => void;
}

/**
 * Compact list of the challenges a member is currently in.
 *
 * Built as a self-contained card so it can be dropped into any screen with one
 * line and no prop plumbing:
 *
 *   <ActiveChallenges onSeeAll={() => router.push('/challenges')} />
 *
 * That is deliberate. The product puts active challenges on Today and crew
 * challenges on Crew, but those screens belong to the other workstream — this
 * keeps the integration to a single insertion rather than a merge conflict.
 */
export function ActiveChallenges({ limit = 3, onOpenChallenge, onSeeAll }: ActiveChallengesProps) {
  const theme = useTheme();
  const { data: mine, isLoading } = useMyChallenges();

  // flatMap rather than filter so the non-null challenge is carried in the type
  // instead of being asserted at every use.
  const active = (mine ?? [])
    .flatMap((entry) =>
      entry.challenge ? [{ challenge: entry.challenge, participation: entry }] : [],
    )
    .filter(({ challenge }) => challengeStatus(challenge.starts_at, challenge.ends_at) !== 'ended')
    // Soonest deadline first: that is the one worth acting on today.
    .sort((a, b) => Date.parse(a.challenge.ends_at) - Date.parse(b.challenge.ends_at));

  const shown = active.slice(0, limit);

  return (
    <Card>
      <Text variant="subheading" heading>
        Challenges
      </Text>

      {isLoading ? (
        <Text variant="caption" tone="muted">
          Loading…
        </Text>
      ) : shown.length === 0 ? (
        <>
          <Text variant="caption" tone="muted">
            You are not in a challenge right now. They are a nudge, not an obligation.
          </Text>
          {onSeeAll ? (
            <Button label="Browse challenges" variant="secondary" onPress={onSeeAll} />
          ) : null}
        </>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {shown.map(({ challenge, participation }) => (
            <ChallengeRow
              key={challenge.id}
              challenge={challenge}
              progress={Number(participation.progress)}
              completed={participation.completed_at !== null}
              onPress={onOpenChallenge}
            />
          ))}

          {onSeeAll ? (
            <Button
              label={seeAllLabel(active.length, shown.length)}
              variant="ghost"
              onPress={onSeeAll}
            />
          ) : null}
        </View>
      )}
    </Card>
  );
}

function seeAllLabel(total: number, shown: number): string {
  return total > shown ? `See all ${total}` : 'All challenges';
}

function ChallengeRow({
  challenge,
  progress,
  completed,
  onPress,
}: {
  challenge: Challenge;
  progress: number;
  completed: boolean;
  onPress?: (challengeId: string) => void;
}) {
  const theme = useTheme();

  const target = Number(challenge.target);
  const label = formatChallengeProgress(challenge.rule_type, progress, target);
  const days = daysRemaining(challenge.ends_at);
  const timing = completed ? 'Complete' : days <= 0 ? 'Ends today' : `${days}d left`;

  const content = (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={[styles.titleRow, { gap: theme.spacing.sm }]}>
        <Text variant="body" numberOfLines={1} style={styles.title}>
          {challenge.badge_emoji ? `${challenge.badge_emoji} ` : ''}
          {challenge.name}
        </Text>
        <Text variant="caption" tone={completed ? 'success' : 'subtle'}>
          {timing}
        </Text>
      </View>

      <ProgressBar
        label={isCombinedProgress(challenge.rule_type) ? 'Crew combined' : 'Your progress'}
        value={progress}
        target={target}
        showCounts={false}
      />

      <Text variant="caption" tone={completed ? 'success' : 'muted'}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => onPress(challenge.id)}
      accessibilityRole="button"
      accessibilityLabel={`${challenge.name}, ${label}, ${timing}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
});
