import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  averageSessionDuration,
  averageSessionsPerWeek,
  compareTrainingBlocks,
  toWeekBuckets,
  useExerciseProgress,
  useMyBadges,
  useMyPrivacySettings,
  useMyProfile,
  usePersonalRecords,
  useTrainingStreak,
  useWeeklyTrainingSummary,
  type PersonalRecordWithExercise,
  type RecordType,
} from '@/api';
import { ActiveChallenges } from '@/components/challenges';
import { ImprovementRow, StatTile, WeeklyBars, type WeeklyMetric } from '@/components/progress';
import { Card, Screen, Text } from '@/components/ui';
import {
  formatCount,
  formatDurationSeconds,
  formatPercentDelta,
  formatVolume,
  formatWeight,
  type WeightUnit,
} from '@/lib/units';
import { useTheme } from '@/theme';

const WEEKS_SHOWN = 12;
const BLOCK_WEEKS = 4;

/**
 * Progress — how the member is actually improving.
 *
 * EVERY NUMBER ON THIS SCREEN COMES FROM THE DATABASE. Epley 1RM and the
 * pound-to-kilogram conversion are generated columns; per-week aggregates come
 * from `weekly_training_summary()`; streaks from `training_streak()`. The screen
 * formats and arranges, it does not calculate.
 *
 * THE RULE THAT SHAPES THE WHOLE LAYOUT: no percentage appears without the
 * measurement behind it. There is no "you improved 200%" anywhere. Improvement
 * always reads "135 lb → 185 lb (+37%)", and where a baseline is zero the
 * percentage is omitted rather than faked, because a percentage from nothing is
 * undefined.
 *
 * TONE: falling behind is never an error state. Comparisons that go down are
 * phrased plainly and stay in a neutral colour — there is no red in the palette
 * for "bad" progress, by design.
 */
export default function ProgressScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const { data: privacy } = useMyPrivacySettings();
  const { data: streak } = useTrainingStreak();
  const { data: weekly, isLoading: loadingWeekly } = useWeeklyTrainingSummary(WEEKS_SHOWN);
  const { data: records } = usePersonalRecords();
  const { data: improvements } = useExerciseProgress();
  const { data: badges } = useMyBadges();

  const [metric, setMetric] = useState<WeeklyMetric>('sessions');

  const weightUnit = profile?.weight_unit ?? 'lb';

  // Dense series: `weekly_training_summary` omits weeks with no sessions, so
  // charting its rows directly would hide breaks entirely.
  const buckets = useMemo(() => toWeekBuckets(weekly, WEEKS_SHOWN), [weekly]);
  const comparison = useMemo(() => compareTrainingBlocks(buckets, BLOCK_WEEKS), [buckets]);

  const totalSessions = buckets.reduce((sum, bucket) => sum + bucket.sessionCount, 0);
  const perWeek = averageSessionsPerWeek(buckets);
  const avgDuration = averageSessionDuration(buckets);

  const hasHistory = totalSessions > 0 || (records?.length ?? 0) > 0;

  if (!loadingWeekly && !hasHistory) {
    return (
      <Screen title="Progress" subtitle="See how you are improving.">
        <Card>
          <Text variant="subheading">Nothing to show yet</Text>
          <Text variant="caption" tone="muted">
            Log a session and this fills in: personal records, estimated one-rep max, training
            volume, and how consistent you have been. Every figure here comes with the measurement
            behind it, so you can always check it.
          </Text>
        </Card>
        <ActiveChallenges
          onSeeAll={() => router.push('/challenges')}
          onOpenChallenge={(challengeId) => router.push(`/challenges/${challengeId}`)}
          onStartChallenge={() => router.push('/challenges/new')}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Progress" subtitle="See how you are improving.">
      {/* Headline figures. Each carries its own measurement as a caption. */}
      <View style={[styles.tiles, { gap: theme.spacing.sm }]}>
        <StatTile
          label="Current streak"
          value={`${streak?.current_streak_weeks ?? 0} wk`}
          caption={`Longest ${streak?.longest_streak_weeks ?? 0} weeks. Counted in weeks, so rest days never break it.`}
          tone={(streak?.current_streak_weeks ?? 0) > 0 ? 'accent' : 'default'}
        />
        <StatTile
          label="Sessions per week"
          value={perWeek.toFixed(1)}
          caption={`${formatCount(totalSessions)} sessions over ${WEEKS_SHOWN} weeks`}
        />
        <StatTile
          label="Average session"
          value={formatDurationSeconds(avgDuration)}
          caption="Mean across finished sessions"
        />
        <StatTile
          label="Volume, last 4 weeks"
          value={formatVolume(
            comparison?.recentVolumeKg ?? currentBlockVolume(buckets),
            weightUnit,
          )}
          caption="Working sets only, warm-ups excluded"
        />
      </View>

      {/* Four-week block comparison. Equal-length blocks rather than calendar
          months, which vary between 4 and 5 weeks and would show a swing from the
          calendar alone. */}
      {comparison ? (
        <Card>
          <Text variant="subheading" heading>
            Last {BLOCK_WEEKS} weeks vs the {BLOCK_WEEKS} before
          </Text>

          <Text variant="body">
            {sessionDeltaMessage(comparison.recentSessions, comparison.previousSessions)}
          </Text>

          <Text variant="caption" tone="muted">
            Sessions: {formatCount(comparison.previousSessions)} →{' '}
            {formatCount(comparison.recentSessions)}
            {appendPercent(comparison.sessionsPercent)}
          </Text>

          <Text variant="caption" tone="muted">
            Volume: {formatVolume(comparison.previousVolumeKg, weightUnit)} →{' '}
            {formatVolume(comparison.recentVolumeKg, weightUnit)}
            {appendPercent(comparison.volumePercent)}
          </Text>

          {comparison.sessionsPercent === null || comparison.volumePercent === null ? (
            <Text variant="caption" tone="subtle">
              A percentage needs something to compare against, so it is left out where the earlier
              block was empty.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Consistency and volume over time. */}
      <Card>
        <View style={[styles.metricToggle, { gap: theme.spacing.sm }]}>
          <MetricTab
            label="Sessions"
            active={metric === 'sessions'}
            onPress={() => setMetric('sessions')}
          />
          <MetricTab
            label="Volume"
            active={metric === 'volume'}
            onPress={() => setMetric('volume')}
          />
        </View>

        <WeeklyBars buckets={buckets} metric={metric} weightUnit={weightUnit} />
      </Card>

      {/* Estimated 1RM improvement, always with both endpoints. */}
      <Card>
        <Text variant="subheading" heading>
          Estimated one-rep max
        </Text>
        {improvements && improvements.length > 0 ? (
          <>
            {improvements.slice(0, 8).map((row) => (
              <ImprovementRow key={row.exercise_id} row={row} weightUnit={weightUnit} />
            ))}
            <Text variant="caption" tone="subtle">
              Epley estimate from your heaviest working set: weight × (1 + reps ÷ 30). Measured
              against your first recorded set for that exercise.
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="muted">
            Log a weighted set with reps and an estimate appears here.
          </Text>
        )}
      </Card>

      {/* Personal records. */}
      <Card>
        <Text variant="subheading" heading>
          Personal records
        </Text>
        {records && records.length > 0 ? (
          records
            .slice(0, 10)
            .map((record) => <RecordRow key={record.id} record={record} weightUnit={weightUnit} />)
        ) : (
          <Text variant="caption" tone="muted">
            No records yet. The first set you log becomes one.
          </Text>
        )}
      </Card>

      {/* Badges earned through challenges. */}
      {badges && badges.length > 0 ? (
        <Card>
          <Text variant="subheading" heading>
            Badges
          </Text>
          <Text variant="body">
            {badges.map((badge) => `${badge.emoji ?? '•'} ${badge.name}`).join('   ')}
          </Text>
        </Card>
      ) : null}

      <ActiveChallenges
        onSeeAll={() => router.push('/challenges')}
        onOpenChallenge={(challengeId) => router.push(`/challenges/${challengeId}`)}
        onStartChallenge={() => router.push('/challenges/new')}
      />

      {/* Plain statement of who can see this. Sharing is off by default. */}
      <Text variant="caption" tone="subtle">
        {privacy?.share_progress_summary
          ? 'Your friends can see your progress summary. You can turn that off in Profile.'
          : 'This is visible only to you. Progress sharing is off until you turn it on in Profile.'}
      </Text>
    </Screen>
  );
}

function MetricTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} chart`}
      style={{
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? theme.colors.primarySoft : 'transparent',
      }}
    >
      <Text variant="caption" tone={active ? 'primary' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

function RecordRow({
  record,
  weightUnit,
}: {
  record: PersonalRecordWithExercise;
  weightUnit: WeightUnit;
}) {
  const theme = useTheme();

  const value = Number(record.value);
  // max_reps is a plain count; every other record type is canonical kilograms.
  const shown =
    record.record_type === 'max_reps'
      ? `${formatCount(value)} reps`
      : formatWeight(value, weightUnit);

  return (
    <View style={[styles.recordRow, { paddingVertical: theme.spacing.xs }]}>
      <View style={styles.recordBody}>
        <Text variant="body" numberOfLines={1}>
          {record.exercise?.name ?? 'Exercise'}
        </Text>
        <Text variant="caption" tone="subtle">
          {recordTypeLabel(record.record_type)} ·{' '}
          {new Date(record.achieved_at).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
      <Text variant="body" tone="muted">
        {shown}
      </Text>
    </View>
  );
}

function recordTypeLabel(type: RecordType): string {
  switch (type) {
    case 'max_weight':
      return 'Heaviest set';
    case 'estimated_1rm':
      return 'Best estimated 1RM';
    case 'max_reps':
      return 'Most reps';
    case 'max_session_volume':
      return 'Best session volume';
  }
}

/** Volume of the most recent block, used when there is no earlier block to compare. */
function currentBlockVolume(buckets: { volumeKg: number }[]): number {
  return buckets.slice(-BLOCK_WEEKS).reduce((sum, bucket) => sum + bucket.volumeKg, 0);
}

/** " (+37%)" or nothing at all when the percentage is undefined. */
function appendPercent(percent: number | null): string {
  const formatted = formatPercentDelta(percent);
  return formatted ? ` (${formatted})` : '';
}

/**
 * Supportive phrasing in every direction.
 *
 * A drop is stated as a fact next to what the member still did, never as a
 * failure. Someone opening this after a hard month is already doing the hard part.
 */
function sessionDeltaMessage(recent: number, previous: number): string {
  const delta = recent - previous;
  const sessions = `${recent} ${recent === 1 ? 'session' : 'sessions'}`;

  if (delta > 0) {
    const times = `${delta} more ${delta === 1 ? 'time' : 'times'}`;
    return `You trained ${times} than the previous ${BLOCK_WEEKS} weeks.`;
  }
  if (delta === 0) {
    return `Same as the previous ${BLOCK_WEEKS} weeks: ${sessions}.`;
  }
  return `${Math.abs(delta)} fewer than the previous ${BLOCK_WEEKS} weeks, with ${sessions} logged.`;
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  metricToggle: {
    flexDirection: 'row',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordBody: {
    flex: 1,
  },
});
