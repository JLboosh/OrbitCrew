import { useState } from 'react';
import { Share, TextInput, View } from 'react-native';

import {
  useCreateCrew,
  useCreateCrewInvite,
  useCrewLeaderboard,
  useCrewMembers,
  useCrewProgress,
  useMyCrews,
  useRedeemCrewInvite,
} from '@/api';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Crew — accountability without pressure.
 *
 * Shows the shared weekly goal, the leaderboard, and admin controls. Ranking is
 * by sessions completed, never by weight lifted or time spent, so a beginner and
 * a powerlifter compete on the same terms: showing up.
 */
export default function CrewScreen() {
  const theme = useTheme();
  const { data: memberships, isLoading } = useMyCrews();
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);

  const membership =
    memberships?.find((m) => m.crew?.id === selectedCrewId) ?? memberships?.[0] ?? null;
  const crew = membership?.crew ?? null;
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';

  const { data: progress } = useCrewProgress(crew?.id);
  const { data: leaderboard } = useCrewLeaderboard(crew?.id);
  const { data: members } = useCrewMembers(crew?.id);

  if (isLoading) {
    return (
      <Screen title="Crew">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  if (!crew) {
    return <NoCrewState />;
  }

  return (
    <Screen title={crew.name} subtitle={`${members?.length ?? 0} members`}>
      {/* Crew switcher, only when it is actually needed. */}
      {memberships && memberships.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {memberships.map((m) =>
            m.crew ? (
              <Button
                key={m.crew.id}
                label={m.crew.name}
                variant={m.crew.id === crew.id ? 'primary' : 'ghost'}
                accessibilityState={{ selected: m.crew.id === crew.id }}
                onPress={() => setSelectedCrewId(m.crew!.id)}
              />
            ) : null,
          )}
        </View>
      ) : null}

      {/* Weekly goal. */}
      {progress ? (
        <Card>
          <Text variant="subheading" heading>
            This week
          </Text>
          <ProgressBar
            label="Combined sessions"
            value={Number(progress.sessions_completed)}
            target={Number(progress.weekly_target)}
            unit="sessions"
          />
          <Text
            variant="caption"
            tone={Number(progress.percent_complete) >= 100 ? 'success' : 'muted'}
          >
            {Number(progress.percent_complete) >= 100
              ? 'Goal reached. Nice work.'
              : `${Math.round(Number(progress.percent_complete))}% of the way there.`}
          </Text>
          <Text variant="caption" tone="subtle">
            Sessions count once they pass {crew.min_session_minutes} minutes. Week resets Monday,{' '}
            {crew.timezone}.
          </Text>
        </Card>
      ) : null}

      {/* Leaderboard. */}
      <Card>
        <Text variant="subheading" heading>
          Leaderboard
        </Text>
        <Text variant="caption" tone="subtle">
          Ranked by sessions completed — not weight or time, so it stays fair.
        </Text>

        <View style={{ marginTop: theme.spacing.sm }}>
          {leaderboard?.length ? (
            leaderboard.map((row, index) => (
              <View
                key={row.user_id}
                accessible
                accessibilityLabel={`${index + 1}. ${row.display_name}, ${row.sessions_completed} sessions${row.is_caller ? ', you' : ''}`}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: theme.spacing.sm,
                  borderBottomWidth: index < leaderboard.length - 1 ? 1 : 0,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Text variant="body" tone="subtle" style={{ width: 20 }}>
                    {index + 1}
                  </Text>
                  <Text variant="body" tone={row.is_caller ? 'primary' : 'default'}>
                    {row.display_name}
                    {row.is_caller ? ' (you)' : ''}
                  </Text>
                </View>
                <Text variant="body" tone="muted">
                  {row.sessions_completed}
                </Text>
              </View>
            ))
          ) : (
            <Text variant="caption" tone="muted">
              No sessions logged this week yet.
            </Text>
          )}
        </View>
      </Card>

      {isAdmin ? <AdminPanel crewId={crew.id} /> : null}

      <Card>
        <Text variant="subheading" heading>
          Join another crew
        </Text>
        <JoinCrewForm />
      </Card>
    </Screen>
  );
}

/** Admin-only invite controls. */
function AdminPanel({ crewId }: { crewId: string }) {
  const theme = useTheme();
  const createInvite = useCreateCrewInvite();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <Text variant="subheading" heading>
        Invite members
      </Text>
      <Text variant="caption" tone="muted">
        Crews are invite-only. Codes expire after 7 days.
      </Text>

      {code ? (
        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <Text variant="metric" accessibilityLabel={`Invite code ${code.split('').join(' ')}`}>
            {code}
          </Text>
          <Button
            label="Share code"
            onPress={() => void Share.share({ message: `Join my gym crew with code ${code}` })}
          />
        </View>
      ) : null}

      <Button
        label={code ? 'Create another code' : 'Create invite code'}
        variant={code ? 'ghost' : 'primary'}
        fullWidth
        loading={createInvite.isPending}
        onPress={async () => {
          setError(null);
          try {
            const invite = await createInvite.mutateAsync({ crewId, expiresInHours: 168 });
            setCode(invite.code);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not create an invite.');
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

function JoinCrewForm() {
  const theme = useTheme();
  const redeem = useRedeemCrewInvite();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        accessibilityLabel="Crew invite code"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="INVITE CODE"
        placeholderTextColor={theme.colors.textSubtle}
        style={{
          minHeight: theme.minTouchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
          fontSize: 18,
          letterSpacing: 2,
        }}
      />
      <Button
        label="Join crew"
        fullWidth
        disabled={code.trim().length < 6}
        loading={redeem.isPending}
        onPress={async () => {
          setError(null);
          try {
            await redeem.mutateAsync(code);
            setCode('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not join.');
          }
        }}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Shown when the member belongs to no crews yet. */
function NoCrewState() {
  const theme = useTheme();
  const createCrew = useCreateCrew();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('12');
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="Crew" subtitle="Training with people makes it stick.">
      <Card>
        <Text variant="subheading" heading>
          Have an invite code?
        </Text>
        <JoinCrewForm />
      </Card>

      <Card>
        <Text variant="subheading" heading>
          Or start your own
        </Text>
        <Text variant="caption" tone="muted">
          Invite-only from the moment you create it. Nobody can find or join it without a code from
          you.
        </Text>

        <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            accessibilityLabel="Crew name"
            placeholder="Waterloo Gym Crew"
            placeholderTextColor={theme.colors.textSubtle}
            style={{
              minHeight: theme.minTouchTarget,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              fontSize: 16,
            }}
          />
          <Text variant="caption" tone="muted">
            Combined sessions per week
          </Text>
          <TextInput
            value={target}
            onChangeText={setTarget}
            accessibilityLabel="Weekly combined session target"
            keyboardType="number-pad"
            style={{
              minHeight: theme.minTouchTarget,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.md,
              color: theme.colors.text,
              backgroundColor: theme.colors.surface,
              fontSize: 16,
            }}
          />
          <Button
            label="Create crew"
            size="large"
            fullWidth
            disabled={name.trim().length < 2}
            loading={createCrew.isPending}
            onPress={async () => {
              setError(null);
              try {
                await createCrew.mutateAsync({
                  name,
                  weeklyTargetSessions: Math.max(1, Number(target) || 12),
                });
                setName('');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not create the crew.');
              }
            }}
          />
          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>
      </Card>
    </Screen>
  );
}
