import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useActiveSession,
  useCheckOut,
  useCrewLeaderboard,
  useCrewMembers,
  useCrewProgress,
  useMyCrews,
  useMyPresence,
  useMyProfile,
  useRecentWorkouts,
} from '@/api';
import { ActiveChallenges, DailyChallengeCard } from '@/components/challenges';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  IconButton,
  ListRow,
  MiniBars,
  ProgressBar,
  Screen,
  SectionHeader,
  Text,
  Wordmark,
} from '@/components/ui';
import { WorkoutSummaryRow } from '@/components/workouts';
import { useTheme } from '@/theme';

/**
 * Today / Overview — makes training frictionless.
 *
 * One primary action above everything else, because mid-workout with a phone in
 * one hand the member should never hunt for "start" or "end".
 *
 * Layout follows the reference design:
 *   * Phone — stacked cards under a wordmark header, bottom tab bar.
 *   * Wide  — two columns, with live crew activity and challenges in a right rail.
 */
export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const { data: activeSession, isLoading: loadingSession } = useActiveSession();
  const { data: presence } = useMyPresence();
  const { data: memberships } = useMyCrews();
  const { data: recent } = useRecentWorkouts(12);

  const checkOut = useCheckOut();

  const crew = memberships?.[0]?.crew ?? null;
  const { data: crewProgress } = useCrewProgress(crew?.id);
  const { data: members } = useCrewMembers(crew?.id);
  const { data: leaderboard } = useCrewLeaderboard(crew?.id);

  const firstName = profile?.display_name?.split(' ')[0] ?? 'there';

  /**
   * Challenges, shared by both layouts.
   *
   * Self-contained: it owns its own queries, so it needs no data plumbing from
   * this screen. Rendered unconditionally — an opted-out member still sees what
   * they could join, which is the point of the panel.
   */
  const challengesCard = (
    <ActiveChallenges
      onSeeAll={() => router.push('/challenges')}
      onOpenChallenge={(challengeId) => router.push(`/challenges/${challengeId}`)}
      onStartChallenge={() => router.push('/challenges/new')}
    />
  );

  /**
   * Today's challenge.
   *
   * Above the joined-challenges card on purpose: it is the one challenge every
   * member always has, it asks for one thing, and it is the shortest path from
   * opening the app to starting a workout.
   */
  const dailyCard = (
    <DailyChallengeCard
      onOpen={() => router.push('/challenges/daily')}
      onStartWorkout={() => router.push('/session/new')}
      compact={theme.isWide}
    />
  );

  const header = (
    <View style={styles.headerRow}>
      {theme.isWide ? (
        <Text variant="caption" tone="muted">
          {formatLongDate()} · Week {isoWeek()}
        </Text>
      ) : (
        <Wordmark />
      )}
      <IconButton
        icon="person-circle-outline"
        label="Your profile and privacy settings"
        onPress={() => router.push('/(tabs)/profile')}
      />
    </View>
  );

  /**
   * Start / continue session, shared by both layouts.
   *
   * Computed as JSX rather than a nested component: a component declared inside
   * render remounts on every parent update, which would restart the session
   * timer's interval each second.
   */
  const primaryAction = loadingSession ? (
    <Text variant="caption" tone="muted">
      Checking for an active session…
    </Text>
  ) : activeSession ? (
    <SessionPill
      startedAt={activeSession.started_at}
      fullWidth={!theme.isWide}
      onPress={() => router.push('/session/active')}
    />
  ) : (
    /*
     * Opens the workout-type picker rather than creating a session immediately.
     * The flow is Start → choose type → choose exercises, and a session created
     * before the type is known could never be labelled retrospectively without
     * guessing. Backing out of the picker also creates nothing.
     */
    <Button
      label="Start a workout"
      icon="play"
      size="large"
      fullWidth={!theme.isWide}
      onPress={() => router.push('/session/new')}
    />
  );

  const heroCard = (
    <Card variant="feature" style={{ gap: theme.spacing.lg }}>
      {crew ? (
        <Text variant="eyebrow" tone="muted">
          {crew.name}
        </Text>
      ) : null}

      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="display" heading>
          {greeting()},{' '}
          <Text variant="display" tone="primary">
            {firstName}.
          </Text>
        </Text>
        <Text variant="body" tone="muted">
          {crewProgress
            ? goalSentence(
                Number(crewProgress.sessions_completed),
                Number(crewProgress.weekly_target),
              )
            : 'Every crew starts with one session.'}
        </Text>
      </View>

      {crewProgress ? (
        <View style={{ gap: theme.spacing.md }}>
          <ProgressBar
            label="Weekly crew goal"
            value={Number(crewProgress.sessions_completed)}
            target={Number(crewProgress.weekly_target)}
            unit="sessions"
          />

          <View style={styles.betweenRow}>
            <View style={[styles.headerRow, { gap: theme.spacing.md }]}>
              {members?.length ? (
                <AvatarStack
                  members={members.map((m) => ({
                    id: m.user_id,
                    name: m.profile?.display_name ?? '?',
                  }))}
                />
              ) : null}
              <Text variant="caption" tone="muted">
                {remainingLabel(
                  Number(crewProgress.sessions_completed),
                  Number(crewProgress.weekly_target),
                )}
              </Text>
            </View>

            {theme.isWide ? primaryAction : null}
          </View>
        </View>
      ) : null}

      {!theme.isWide ? primaryAction : null}
    </Card>
  );

  const readyCard = (
    <Card style={{ gap: theme.spacing.md }}>
      <View style={styles.betweenRow}>
        <Text variant="heading" heading>
          {activeSession ? 'Session in progress' : 'Ready when you are'}
        </Text>
        {presence ? <Badge label="Checked in" tone="accent" live /> : null}
      </View>

      {presence?.gym?.name ? (
        <View style={[styles.headerRow, { gap: theme.spacing.xs }]}>
          <Ionicons name="location-outline" size={15} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted">
            {presence.gym.name} · until{' '}
            {new Date(presence.expires_at).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {activeSession
            ? 'Log your sets as you go — everything saves immediately.'
            : 'Start now, or pick a gym from Explore to check in.'}
        </Text>
      )}

      {activeSession ? (
        <SessionPill
          startedAt={activeSession.started_at}
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

      {presence ? (
        <Button
          label="Check out"
          variant="ghost"
          size="small"
          loading={checkOut.isPending}
          onPress={() => checkOut.mutate()}
        />
      ) : null}
    </Card>
  );

  const leaderboardCard = (
    <Card>
      <SectionHeader
        title="Weekly leaderboard"
        actionLabel="Full board"
        onAction={() => router.push('/(tabs)/crew')}
      />
      {leaderboard?.length ? (
        leaderboard.slice(0, 4).map((row, index) => (
          <ListRow
            key={row.user_id}
            title={row.is_caller ? 'You' : row.display_name}
            subtitle={`${row.sessions_completed} session${Number(row.sessions_completed) === 1 ? '' : 's'} this week`}
            value={String(row.sessions_completed)}
            divider={index < Math.min(leaderboard.length, 4) - 1}
            leading={
              <View style={[styles.headerRow, { gap: theme.spacing.md }]}>
                <Text variant="caption" tone="subtle">
                  {String(index + 1).padStart(2, '0')}
                </Text>
                <Avatar id={row.user_id} name={row.display_name} size={34} />
              </View>
            }
          />
        ))
      ) : (
        <Text variant="caption" tone="muted">
          No sessions logged this week yet.
        </Text>
      )}
    </Card>
  );

  const momentumCard = (
    <Card style={{ gap: theme.spacing.md }}>
      <SectionHeader
        title="Your momentum"
        actionLabel="Details"
        onAction={() => router.push('/(tabs)/progress')}
      />
      <MiniBars values={weeklyCounts(recent ?? [])} label="Sessions per week" />
      <Text variant="caption" tone="muted">
        {recent?.length ?? 0} session{recent?.length === 1 ? '' : 's'} recorded recently
      </Text>
    </Card>
  );

  /**
   * Recent workouts, labelled by what was trained.
   *
   * "🦵 Legs · 58m · 6 exercises" rather than "Tuesday, Sep 15 · 58 min". The date
   * alone answers a question nobody was asking; the type is what makes a history
   * list worth opening, and it is also what tells you what to train next.
   */
  const recentCard = (
    <Card flush style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm }}>
      <View style={{ paddingTop: theme.spacing.md }}>
        <SectionHeader
          title="Recent workouts"
          actionLabel={recent && recent.length > 4 ? 'All' : undefined}
          onAction={recent && recent.length > 4 ? () => router.push('/(tabs)/progress') : undefined}
        />
      </View>
      {recent?.length ? (
        recent
          .slice(0, 4)
          .map((workout, index) => (
            <WorkoutSummaryRow
              key={workout.id}
              workout={workout}
              divider={index < Math.min(recent.length, 4) - 1}
              onPress={(sessionId) => router.push(`/session/${sessionId}`)}
            />
          ))
      ) : (
        <View style={{ paddingBottom: theme.spacing.md }}>
          <Text variant="caption" tone="muted">
            No workouts yet. Your first one starts whenever you are ready.
          </Text>
        </View>
      )}
    </Card>
  );

  // -------------------------------------------------------------------------
  // Wide layout: main column plus a right rail.
  // -------------------------------------------------------------------------
  if (theme.isWide) {
    return (
      <Screen header={header}>
        <View style={[styles.columns, { gap: theme.spacing.lg }]}>
          <View style={{ flex: 2, gap: theme.spacing.lg }}>
            {heroCard}
            <View style={[styles.columns, { gap: theme.spacing.lg }]}>
              <View style={{ flex: 1 }}>{leaderboardCard}</View>
              <View style={{ flex: 1 }}>{momentumCard}</View>
            </View>
            {recentCard}
          </View>

          <View style={{ flex: 1, gap: theme.spacing.lg, minWidth: 280 }}>
            {readyCard}
            {dailyCard}
            {challengesCard}
            <Card>
              <SectionHeader
                title="Crew"
                actionLabel="Open"
                onAction={() => router.push('/(tabs)/crew')}
              />
              {crew ? (
                <>
                  <Text variant="subheading">{crew.name}</Text>
                  <Text variant="caption" tone="muted">
                    Resets Monday · {crew.timezone}
                  </Text>
                  <Text variant="caption" tone="muted">
                    Sessions count past {crew.min_session_minutes} minutes.
                  </Text>
                </>
              ) : (
                <Text variant="caption" tone="muted">
                  You are not in a crew yet.
                </Text>
              )}
            </Card>
          </View>
        </View>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Phone layout: stacked.
  // -------------------------------------------------------------------------
  return (
    <Screen header={header} eyebrow={formatLongDate()} title={undefined}>
      <Text variant="display" heading>
        Make today{' '}
        <Text variant="display" tone="primary">
          count.
        </Text>
      </Text>

      {readyCard}

      {crew && crewProgress ? (
        <Card variant="feature" style={{ gap: theme.spacing.md }}>
          <Text variant="eyebrow" tone="muted">
            {crew.name} · {members?.length ?? 0} members
          </Text>

          <View style={styles.betweenRow}>
            <Text variant="metric">
              {crewProgress.sessions_completed} / {crewProgress.weekly_target} sessions
            </Text>
            <Text variant="subheading" tone="primary">
              {Math.round(Number(crewProgress.percent_complete))}%
            </Text>
          </View>

          <ProgressBar
            label="Weekly crew goal"
            value={Number(crewProgress.sessions_completed)}
            target={Number(crewProgress.weekly_target)}
            showCounts={false}
          />

          <Text variant="caption" tone="muted">
            {remainingLabel(
              Number(crewProgress.sessions_completed),
              Number(crewProgress.weekly_target),
            )}
          </Text>

          {members?.length ? (
            <AvatarStack
              members={members.map((m) => ({
                id: m.user_id,
                name: m.profile?.display_name ?? '?',
              }))}
            />
          ) : null}
        </Card>
      ) : null}

      {dailyCard}
      {challengesCard}
      {leaderboardCard}
      {recentCard}
    </Screen>
  );
}

/** Dark green pill showing the running session and its elapsed time. */
function SessionPill({
  startedAt,
  onPress,
  fullWidth = true,
}: {
  startedAt: string;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  const elapsed = useElapsedSeconds(startedAt);

  return (
    <Button
      label="Session active"
      size="large"
      fullWidth={fullWidth}
      trailing={formatClock(elapsed)}
      onPress={onPress}
    />
  );
}

/** Ticks once a second while a session is running. */
function useElapsedSeconds(startedAt: string): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatLongDate(): string {
  return new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function isoWeek(): number {
  const date = new Date();
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/**
 * Supportive copy in every branch.
 *
 * Never scolds: someone opening the app after two weeks away is already doing the
 * hard part.
 */
function goalSentence(completed: number, target: number): string {
  const remaining = Math.max(target - completed, 0);
  if (remaining === 0) return 'Your crew hit its weekly goal. One more still counts.';
  if (completed === 0) return 'Nothing logged yet this week. One session gets it moving.';
  return `Your crew is ${Math.round((completed / Math.max(target, 1)) * 100)}% of the way there. One session takes the team closer.`;
}

function remainingLabel(completed: number, target: number): string {
  const remaining = Math.max(target - completed, 0);
  if (remaining === 0) return 'Goal reached';
  return `${remaining} session${remaining === 1 ? '' : 's'} to go`;
}

/** Buckets recent sessions into the last 8 weeks for the momentum sparkline. */
function weeklyCounts(sessions: { started_at: string }[]): number[] {
  const weeks = new Array(8).fill(0) as number[];
  const now = Date.now();

  for (const session of sessions) {
    const ageWeeks = Math.floor((now - new Date(session.started_at).getTime()) / (7 * 86400000));
    if (ageWeeks < 0 || ageWeeks >= weeks.length) continue;

    // Reverse so the most recent week is the last (emphasised) bar.
    const index = weeks.length - 1 - ageWeeks;
    weeks[index] = (weeks[index] ?? 0) + 1;
  }

  return weeks;
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  betweenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
});
