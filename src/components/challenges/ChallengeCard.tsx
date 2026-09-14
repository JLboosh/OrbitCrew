import { Pressable, StyleSheet, View } from 'react-native';

import type { Challenge } from '@/api';
import { ProgressBar, Text } from '@/components/ui';
import {
  challengeStatus,
  daysRemaining,
  describeChallengeRule,
  formatChallengeProgress,
  isCombinedProgress,
  type ChallengeStatus,
} from '@/lib/challengeRules';
import { useTheme } from '@/theme';

export interface ChallengeCardProps {
  challenge: Challenge;
  /**
   * The member's cached progress, or the crew's combined progress for a
   * `crew_session_total` challenge. Null when they have not joined.
   */
  progress: number | null;
  completedAt?: string | null;
  /** Shown for crew challenges so the "combined" framing is explicit. */
  participantCount?: number;
  onPress?: (challenge: Challenge) => void;
}

/**
 * Summary card for one challenge.
 *
 * PROGRESS IS DISPLAYED, NEVER DERIVED. The value comes from
 * `challenge_participants.progress`, refreshed by `rescore_challenge()`. This
 * component does not count sessions, so it cannot disagree with the engine about
 * whether someone finished.
 *
 * The description is generated from the rule rather than taken from the
 * template's prose, so a challenge created with an overridden target still
 * describes itself accurately.
 */
export function ChallengeCard({
  challenge,
  progress,
  completedAt,
  participantCount,
  onPress,
}: ChallengeCardProps) {
  const theme = useTheme();

  const status = challengeStatus(challenge.starts_at, challenge.ends_at);
  const target = Number(challenge.target);
  const current = progress ?? 0;
  const combined = isCombinedProgress(challenge.rule_type);
  const completed = Boolean(completedAt) || current >= target;

  const description = describeChallengeRule(challenge.rule_type, challenge.rule, target);
  const progressLabel = formatChallengeProgress(challenge.rule_type, current, target);

  const timing = describeTiming(status, challenge.ends_at, completed);

  const body = (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.header}>
        <Text variant="subheading" numberOfLines={2} style={styles.title}>
          {challenge.badge_emoji ? `${challenge.badge_emoji} ` : ''}
          {challenge.name}
        </Text>
        {challenge.scope === 'crew' ? (
          <Text variant="caption" tone="primary">
            Crew
          </Text>
        ) : null}
      </View>

      <Text variant="caption" tone="muted">
        {description}
      </Text>

      <ProgressBar
        label={combined ? 'Crew combined progress' : 'Your progress'}
        value={current}
        target={target}
        showCounts={false}
      />

      <View style={styles.header}>
        <Text variant="caption" tone={completed ? 'success' : 'muted'}>
          {progressLabel}
        </Text>
        <Text variant="caption" tone={completed ? 'success' : 'subtle'}>
          {timing}
        </Text>
      </View>

      {combined && participantCount !== undefined ? (
        <Text variant="caption" tone="subtle">
          {participantCount} {participantCount === 1 ? 'member' : 'members'} taking part. Everyone
          finishes together when the crew reaches the target.
        </Text>
      ) : null}

      {progress === null ? (
        <Text variant="caption" tone="subtle">
          You have not joined this one yet.
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) {
    return (
      <View
        style={[
          styles.card,
          {
            padding: theme.spacing.lg,
            borderRadius: theme.radius.lg,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(challenge)}
      accessibilityRole="button"
      accessibilityLabel={`${challenge.name}. ${description} ${progressLabel}. ${timing}`}
      style={({ pressed }) => [
        styles.card,
        {
          padding: theme.spacing.lg,
          borderRadius: theme.radius.lg,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Timing copy.
 *
 * "Finished" wins over the countdown, and a lapsed challenge simply reads
 * "Ended". No scolding language for a challenge that ran out — the member either
 * did it or the window closed, and neither needs a reprimand.
 */
function describeTiming(status: ChallengeStatus, endsAt: string, completed: boolean): string {
  if (completed) return 'Complete';
  if (status === 'ended') return 'Ended';
  if (status === 'upcoming') return 'Not started yet';

  const days = daysRemaining(endsAt);
  if (days <= 0) return 'Ends today';
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
  },
});
