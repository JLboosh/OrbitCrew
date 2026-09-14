import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  useActiveSession,
  useCheckOut,
  useCrewProgress,
  useMyCrews,
  useMyPresence,
  useMyProfile,
  useRecentSessions,
  useStartSession,
} from '@/api';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Today — the screen that makes training frictionless.
 *
 * One primary action above everything else. Mid-workout, with a phone in one
 * hand, the member should never have to hunt for "start" or "end".
 */
export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const { data: activeSession, isLoading: loadingSession } = useActiveSession();
  const { data: presence } = useMyPresence();
  const { data: crews } = useMyCrews();
  const { data: recent } = useRecentSessions(5);

  const startSession = useStartSession();
  const checkOut = useCheckOut();

  const firstCrew = crews?.[0]?.crew;
  const { data: crewProgress } = useCrewProgress(firstCrew?.id);

  const greeting = getGreeting();
  const firstName = profile?.display_name?.split(' ')[0] ?? 'there';

  return (
    <Screen title={`${greeting}, ${firstName}`} subtitle={encouragement(recent?.length ?? 0)}>
      {/* Primary action. */}
      <Card>
        {loadingSession ? (
          <Text variant="body" tone="muted">
            Checking for an active session…
          </Text>
        ) : activeSession ? (
          <View style={{ gap: theme.spacing.md }}>
            <View>
              <Text variant="caption" tone="muted">
                Session in progress
              </Text>
              <ElapsedTimer startedAt={activeSession.started_at} />
            </View>
            <Button
              label="Continue session"
              size="large"
              fullWidth
              onPress={() => router.push('/session/active')}
            />
          </View>
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            <Text variant="subheading">Ready to train?</Text>
            <Text variant="caption" tone="muted">
              Start a session now, or pick a gym from the map to check in.
            </Text>
            <Button
              label="Start session"
              size="large"
              fullWidth
              loading={startSession.isPending}
              onPress={async () => {
                await startSession.mutateAsync({});
                router.push('/session/active');
              }}
            />
          </View>
        )}
      </Card>

      {/* Presence, shown only when checked in, with a plain-language reminder
          of who can see it. */}
      {presence ? (
        <Card>
          <Text variant="subheading">
            Checked in{presence.gym?.name ? ` at ${presence.gym.name}` : ''}
          </Text>
          <Text variant="caption" tone="muted">
            Visible only to people you have chosen. Automatically ends by{' '}
            {new Date(presence.expires_at).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
            .
          </Text>
          <Button
            label="Check out"
            variant="ghost"
            loading={checkOut.isPending}
            onPress={() => checkOut.mutate()}
          />
        </Card>
      ) : null}

      {/* Crew weekly goal. */}
      {firstCrew && crewProgress ? (
        <Card>
          <Text variant="subheading">{firstCrew.name}</Text>
          <ProgressBar
            label="Weekly goal"
            value={Number(crewProgress.sessions_completed)}
            target={Number(crewProgress.weekly_target)}
            unit="sessions"
          />
          <Text
            variant="caption"
            tone={Number(crewProgress.percent_complete) >= 100 ? 'success' : 'muted'}
          >
            {crewGoalMessage(Number(crewProgress.percent_complete))}
          </Text>
          <Button label="Open crew" variant="ghost" onPress={() => router.push('/(tabs)/crew')} />
        </Card>
      ) : null}

      {/* Recent activity. */}
      <Card>
        <Text variant="subheading">Recent sessions</Text>
        {recent?.length ? (
          recent.map((session) => (
            <View
              key={session.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: theme.spacing.xs,
              }}
            >
              <Text variant="body">
                {new Date(session.started_at).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <Text variant="body" tone="muted">
                {formatDuration(session.duration_seconds)}
              </Text>
            </View>
          ))
        ) : (
          <Text variant="caption" tone="muted">
            No sessions yet. Your first one starts whenever you are ready.
          </Text>
        )}
      </Card>
    </Screen>
  );
}

/** Live elapsed time for the active session. */
function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));

  return (
    <Text variant="metric" accessibilityLabel={`Elapsed time ${formatDuration(elapsed)}`}>
      {formatClock(elapsed)}
    </Text>
  );
}

function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Supportive copy in every branch.
 *
 * Deliberately never scolds. Someone opening the app after two weeks away is
 * already doing the hard part.
 */
function encouragement(recentCount: number): string {
  if (recentCount === 0) return 'Every crew starts with one session.';
  if (recentCount < 3) return 'Good to see you back.';
  return 'You have been consistent lately.';
}

function crewGoalMessage(percent: number): string {
  if (percent >= 100) return 'Your crew hit its weekly goal.';
  if (percent >= 75) return `Your crew is ${Math.round(percent)}% of the way there.`;
  if (percent >= 25) return `${Math.round(percent)}% of the way. Every session counts.`;
  return 'Early in the week. Plenty of time.';
}
