import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useActiveSession, useDailyChallenge, useRefreshDailyChallenge } from '@/api';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { describeQualification } from '@/lib/challengeRules';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

/**
 * The Daily Challenge in full.
 *
 * Everything a member needs in order to trust the number: today's progress, how a
 * session qualifies, which timezone the day is measured in, and the last week at a
 * glance. That transparency is the same reason the challenge-detail screen states
 * its rule — progress nobody can explain is progress nobody believes, and "why
 * didn't my workout count" is the question this screen exists to pre-empt.
 *
 * It works for every account. Nothing here reads a crew, a friendship, or any
 * property that some members have and others do not.
 */
export default function DailyChallengeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, error, refetch, isFetching } = useDailyChallenge();
  const { data: activeSession } = useActiveSession();
  const refresh = useRefreshDailyChallenge();

  if (isLoading) {
    return (
      <Screen title="Daily challenge">
        <Text tone="muted">Loading today&apos;s challenge…</Text>
      </Screen>
    );
  }

  if (isError || !data) {
    return (
      <Screen title="Daily challenge">
        <Card>
          <Text variant="subheading">Today&apos;s challenge did not load</Text>
          <Text variant="caption" tone="muted">
            {errorMessage(
              error,
              'We could not reach the challenge just now. Nothing about your training is affected, and retrying is safe.',
            )}
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            loading={isFetching}
            onPress={() => refetch()}
          />
          <Button
            label="All challenges"
            variant="ghost"
            onPress={() => router.push('/challenges')}
          />
        </Card>
      </Screen>
    );
  }

  const { today, history, completedInWindow, windowDays } = data;

  return (
    <Screen title={`${data.emoji} ${data.name}`} subtitle={data.description}>
      <Card style={{ gap: theme.spacing.md }}>
        <ProgressBar
          label="Today's progress"
          value={today.progress}
          target={today.target}
          unit={today.target === 1 ? 'session' : 'sessions'}
        />

        <Text variant="subheading" tone={today.completed ? 'success' : 'default'}>
          {today.completed
            ? 'Complete. Nice work.'
            : `${today.progress} of ${today.target} — one qualifying session does it.`}
        </Text>

        {today.completed ? (
          <Text variant="caption" tone="muted">
            It resets at midnight in your own timezone, so tomorrow starts fresh.
          </Text>
        ) : activeSession ? (
          <Button
            label="Back to my workout"
            size="large"
            fullWidth
            onPress={() => router.push('/session/active')}
          />
        ) : (
          <Button
            label="Start a workout"
            icon="play"
            size="large"
            fullWidth
            onPress={() => router.push('/session/new')}
          />
        )}
      </Card>

      {/* How it is scored, stated plainly. */}
      <Card>
        <Text variant="subheading" heading>
          How this is scored
        </Text>
        <Text variant="caption" tone="muted">
          {describeQualification(null)} A workout you are still in does not count until you finish
          it.
        </Text>
        <Text variant="caption" tone="muted">
          Today runs from{' '}
          {new Date(data.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{' '}
          to {new Date(data.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{' '}
          in {data.timezone}, which comes from your profile — not from whichever device you happen
          to be holding.
        </Text>
        {!data.timezoneHonoured ? (
          <Text variant="caption" tone="subtle">
            This build cannot read timezone data, so the day is measured by your device clock
            instead. It will still be a full day, just possibly offset from {data.timezone}.
          </Text>
        ) : null}
        <Button
          label="Refresh progress"
          variant="ghost"
          loading={refresh.isPending}
          onPress={() => refresh.mutate()}
        />
      </Card>

      {/* The last week. A count, not a daily streak. */}
      <Card>
        <Text variant="subheading" heading>
          Last {windowDays} days
        </Text>
        <View style={[styles.days, { gap: theme.spacing.sm }]}>
          {[...history].reverse().map((day) => (
            <DayPip key={day.dayKey} dayKey={day.dayKey} completed={day.completed} />
          ))}
        </View>
        <Text variant="body">
          {completedInWindow} of {windowDays} completed.
        </Text>
        <Text variant="caption" tone="subtle">
          There is no daily streak to lose here, on purpose: a rest day is part of training, and a
          number that punishes one would push people into training when they should not. The streak
          on your Progress screen is counted in weeks for the same reason.
        </Text>
      </Card>

      <Button label="All challenges" variant="ghost" onPress={() => router.push('/challenges')} />
    </Screen>
  );
}

/** One day in the recap: initial letter, filled when the challenge was completed. */
function DayPip({ dayKey, completed }: { dayKey: string; completed: boolean }) {
  const theme = useTheme();

  const date = new Date(`${dayKey}T12:00:00`);
  const valid = !Number.isNaN(date.getTime());
  const letter = valid ? date.toLocaleDateString([], { weekday: 'narrow' }) : '?';
  const full = valid
    ? date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
    : dayKey;

  return (
    <View
      accessible
      accessibilityLabel={`${full}: ${completed ? 'completed' : 'not completed'}`}
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        // An incomplete day is a neutral empty track, never a red mark. Being
        // behind is not an error state anywhere in this app.
        borderColor: completed ? theme.colors.success : theme.colors.border,
        backgroundColor: completed ? theme.colors.successSoft : 'transparent',
      }}
    >
      <Text variant="caption" tone={completed ? 'success' : 'subtle'} style={{ fontWeight: '600' }}>
        {letter}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  days: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});
