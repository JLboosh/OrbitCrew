import { Pressable, StyleSheet, View } from 'react-native';

import { useDailyChallenge } from '@/api';
import { Button, Card, ProgressBar, Text } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

export interface DailyChallengeCardProps {
  /** Opens the full daily-challenge screen. */
  onOpen?: () => void;
  /** Starts a workout, for the member who has not trained today. */
  onStartWorkout?: () => void;
  /** Hides the seven-day recap, for tight spaces like a dashboard rail. */
  compact?: boolean;
}

/**
 * Today's challenge.
 *
 * WHY THIS IS ALWAYS THERE FOR EVERY MEMBER
 * -----------------------------------------
 * It asks for one thing — train today — and it is a PERSONAL challenge created on
 * demand, so it does not depend on being in a crew, having friends, or having any
 * history. A brand-new account with nothing in it sees the same working card as the
 * member who has trained for months. That is deliberate: the previous demo only had
 * a crew challenge, so anyone outside that one crew had nothing to open at all.
 *
 * THE ERROR STATE IS A FEATURE, NOT A FALLBACK. If the challenge cannot be created
 * or read, this says so and offers a retry, because the alternative — an empty card
 * — is indistinguishable from "you have no challenges" and sends the member looking
 * for a setting they have not got wrong.
 */
export function DailyChallengeCard({
  onOpen,
  onStartWorkout,
  compact = false,
}: DailyChallengeCardProps) {
  const theme = useTheme();
  const { data, isPending, isError, error, refetch, isFetching } = useDailyChallenge();

  /**
   * `isPending` rather than `isLoading`, which matters more than it looks.
   *
   * `isLoading` is `isPending && isFetching`, so it is FALSE for a query that has
   * not started — which is exactly the state `useDailyChallenge` is in while it
   * waits for the profile, or when it is disabled because nobody is signed in.
   * With `isLoading` those states fell through to the error branch below and
   * claimed the challenge had failed to load when nothing had been attempted.
   */
  if (isPending) {
    return (
      <Card>
        <Text variant="eyebrow" tone="muted">
          Daily challenge
        </Text>
        <Text variant="caption" tone="muted">
          Loading today&apos;s challenge…
        </Text>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <Text variant="eyebrow" tone="muted">
          Daily challenge
        </Text>
        <Text variant="subheading">Today&apos;s challenge did not load</Text>
        <Text variant="caption" tone="muted">
          {errorMessage(
            error,
            'We could not reach the challenge just now. Your training is unaffected — nothing is lost by retrying.',
          )}
        </Text>
        <Button
          label="Try again"
          variant="secondary"
          loading={isFetching}
          onPress={() => refetch()}
        />
      </Card>
    );
  }

  const { today, completedInWindow, windowDays } = data;

  /**
   * The readable part of the card, which is what "open the challenge" applies to.
   *
   * SEPARATED FROM THE ACTION BUTTON ON PURPOSE. This used to be one block wrapped
   * in a Pressable, with the "Start a workout" Button inside it — a control nested
   * inside another control. On web that is not merely untidy: react-native-web
   * renders `accessibilityRole="button"` as a real `<button>`, so it produced a
   * `<button>` inside a `<button>`, which React rejects as invalid nesting and
   * which no screen reader can describe sensibly. It went unnoticed because this
   * whole branch never rendered while the daily challenge was failing to load.
   */
  const summary = (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.between}>
        <Text variant="eyebrow" tone="muted">
          Daily challenge
        </Text>
        <Text variant="caption" tone={today.completed ? 'success' : 'subtle'}>
          {today.completed ? 'Done today' : 'Today'}
        </Text>
      </View>

      <Text variant="heading" heading>
        {data.emoji} {today.completed ? 'Challenge complete' : data.name}
      </Text>

      <Text variant="body" tone="muted">
        {today.completed
          ? 'You trained today. That is the whole challenge — it resets in the morning.'
          : data.description}
      </Text>

      <ProgressBar
        label="Today's progress"
        value={today.progress}
        target={today.target}
        unit={today.target === 1 ? 'session' : 'sessions'}
      />

      {!compact ? (
        <Text variant="caption" tone="subtle">
          {completedInWindow} of the last {windowDays} days completed. Streaks in this app are
          counted in weeks, not days, so a rest day never breaks anything.
        </Text>
      ) : null}
    </View>
  );

  const startButton =
    !today.completed && onStartWorkout ? (
      <Button label="Start a workout" icon="play" variant="secondary" onPress={onStartWorkout} />
    ) : null;

  return (
    <Card>
      {onOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Daily challenge, ${today.progress} of ${today.target}${
            today.completed ? ', complete' : ''
          }`}
          accessibilityHint="Opens today's challenge."
          onPress={onOpen}
          style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
        >
          {summary}
        </Pressable>
      ) : (
        summary
      )}

      {/* Sibling of the pressable summary, never a child of it. */}
      {startButton}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
