import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type RecordType = Database['public']['Enums']['record_type'];

/**
 * Stats: personal records, estimated 1RM, volume, consistency, streaks.
 *
 * EVERY NUMBER HERE IS COMPUTED IN THE DATABASE.
 * `sets.weight_kg` and `sets.estimated_1rm_kg` are generated columns, Epley lives
 * in the schema, and the per-week aggregation happens in
 * `weekly_training_summary()`. This module fetches and reshapes; it does not
 * recalculate. That is the whole reason the app, the challenge engine, and the
 * leaderboard can never disagree about a member's numbers.
 *
 * The one derivation performed here is BUCKETING: turning the sparse per-week
 * rows the RPC returns into a dense series so a chart can show weeks with no
 * training as gaps rather than skipping them. No metric is recomputed.
 *
 * PRODUCT RULE: no percentage may be displayed without the measurement behind
 * it. `exercise_progress()` returns baseline and current precisely so the UI can
 * render "135 lb → 185 lb (+37%)". Never show the bare percentage.
 */

/**
 * Per-exercise 1RM improvement.
 *
 * Declared locally because `supabase gen types` drops nullability on
 * set-returning functions: `baseline_1rm_kg` and `improvement_percent` are
 * genuinely null for a bodyweight exercise or a zero baseline, and the UI must
 * handle that rather than trusting the generated non-null types.
 */
export interface ExerciseProgressRow {
  exercise_id: string;
  exercise_name: string;
  baseline_1rm_kg: number | null;
  current_1rm_kg: number | null;
  improvement_percent: number | null;
  achieved_at: string;
}

export function useExerciseProgress() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.exerciseProgress(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<ExerciseProgressRow[]> => {
      const { data, error } = await supabase.rpc('exercise_progress');
      if (error) throw error;
      return (data ?? []) as ExerciseProgressRow[];
    },
  });
}

export interface WeeklySummaryRow {
  week_start: string;
  session_count: number;
  total_volume_kg: number;
  total_duration_seconds: number;
  avg_duration_seconds: number | null;
}

/**
 * Sessions, volume, and durations per ISO week.
 *
 * Weeks are Monday-anchored in the MEMBER'S timezone, so a Sunday-night session
 * lands in the week it felt like rather than being pushed into the next week by
 * UTC. Weeks with no training produce NO ROW — see `toWeekBuckets`.
 */
export function useWeeklyTrainingSummary(weeks = 12) {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.weeklySummary(weeks),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<WeeklySummaryRow[]> => {
      const { data, error } = await supabase.rpc('weekly_training_summary', { p_weeks: weeks });
      if (error) throw error;
      return (data ?? []) as WeeklySummaryRow[];
    },
  });
}

export interface TrainingStreak {
  current_streak_weeks: number;
  longest_streak_weeks: number;
  last_session_at: string | null;
}

/**
 * Consecutive-week training streak.
 *
 * WEEKS, NOT DAYS, and that is a product decision rather than a technical one: a
 * rest day is part of training, so a daily streak would punish sensible
 * programming and pressure members into overtraining to keep a number alive.
 */
export function useTrainingStreak() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.trainingStreak(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<TrainingStreak | null> => {
      const { data, error } = await supabase.rpc('training_streak').maybeSingle();
      if (error) throw error;
      return (data as TrainingStreak | null) ?? null;
    },
  });
}

export type PersonalRecordRow = Database['public']['Tables']['personal_records']['Row'];

export interface PersonalRecordWithExercise extends PersonalRecordRow {
  exercise: {
    id: string;
    name: string;
    primary_muscle: Database['public']['Enums']['muscle_group'];
    is_weighted: boolean;
  } | null;
}

/**
 * Current personal bests.
 *
 * Trigger-maintained and read-only to clients: there is no INSERT policy on this
 * table, so a member cannot fabricate a PR. Values are kilograms, except
 * `max_reps` which is a plain count.
 */
export function usePersonalRecords() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.personalRecords(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<PersonalRecordWithExercise[]> => {
      const { data, error } = await supabase
        .from('personal_records')
        .select('*, exercise:exercises ( id, name, primary_muscle, is_weighted )')
        .order('achieved_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PersonalRecordWithExercise[];
    },
  });
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeekBucket {
  weekStart: Date;
  sessionCount: number;
  volumeKg: number;
  durationSeconds: number;
}

/**
 * Expands the sparse RPC rows into a dense, oldest-first series of `weeks`
 * buckets, filling untrained weeks with zeros.
 *
 * Necessary because `weekly_training_summary` groups over sessions, so a week
 * with no training simply is not in the result. A chart built directly from those
 * rows would silently compress a three-week break into a continuous line, making
 * a gap look like consistency.
 *
 * Rows are matched to buckets by ROUNDING the gap to whole weeks rather than by
 * comparing timestamps exactly. The database anchors weeks in the member's
 * profile timezone while this runs in the device timezone; rounding absorbs both
 * that difference and any DST hour shift, so a session can never land in the
 * wrong bucket over a discrepancy of a few hours.
 */
export function toWeekBuckets(
  rows: WeeklySummaryRow[] | undefined,
  weeks: number,
  now: Date = new Date(),
): WeekBucket[] {
  const currentWeekStart = startOfLocalWeek(now);
  const byIndex = new Map<number, WeeklySummaryRow>();

  for (const row of rows ?? []) {
    const ms = new Date(row.week_start).getTime();
    if (!Number.isFinite(ms)) continue;

    // 0 = this week, 1 = last week, and so on.
    const index = Math.round((currentWeekStart.getTime() - ms) / WEEK_MS);
    if (index >= 0 && index < weeks) byIndex.set(index, row);
  }

  const buckets: WeekBucket[] = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const row = byIndex.get(index);
    buckets.push({
      weekStart: new Date(currentWeekStart.getTime() - index * WEEK_MS),
      sessionCount: Number(row?.session_count ?? 0),
      volumeKg: Number(row?.total_volume_kg ?? 0),
      durationSeconds: Number(row?.total_duration_seconds ?? 0),
    });
  }
  return buckets;
}

/** Monday 00:00 in the device's timezone. */
function startOfLocalWeek(now: Date): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (midnight.getDay() + 6) % 7;
  midnight.setDate(midnight.getDate() - daysSinceMonday);
  return midnight;
}

export interface TrainingBlockComparison {
  blockWeeks: number;
  recentSessions: number;
  previousSessions: number;
  recentVolumeKg: number;
  previousVolumeKg: number;
  /** Null when the earlier block had none, because a percentage from zero is undefined. */
  sessionsPercent: number | null;
  volumePercent: number | null;
}

/**
 * Compares the most recent N weeks with the N before them.
 *
 * FOUR-WEEK BLOCKS RATHER THAN CALENDAR MONTHS, on purpose. Months are 4 or 5
 * weeks long, so "this month vs last month" can show a 25% swing from the
 * calendar alone. Equal-length blocks make the comparison mean what it says.
 *
 * Returns null percentages when the earlier block is zero: "up from nothing" is
 * not a percentage, and printing ∞% or 100% would be the kind of meaningless
 * figure the product rules forbid. Callers show the raw counts instead.
 */
export function compareTrainingBlocks(
  buckets: WeekBucket[],
  blockWeeks = 4,
): TrainingBlockComparison | null {
  if (buckets.length < blockWeeks * 2) return null;

  const recent = buckets.slice(buckets.length - blockWeeks);
  const previous = buckets.slice(buckets.length - blockWeeks * 2, buckets.length - blockWeeks);

  const recentSessions = sum(recent.map((bucket) => bucket.sessionCount));
  const previousSessions = sum(previous.map((bucket) => bucket.sessionCount));
  const recentVolumeKg = sum(recent.map((bucket) => bucket.volumeKg));
  const previousVolumeKg = sum(previous.map((bucket) => bucket.volumeKg));

  return {
    blockWeeks,
    recentSessions,
    previousSessions,
    recentVolumeKg,
    previousVolumeKg,
    sessionsPercent: percentChange(previousSessions, recentSessions),
    volumePercent: percentChange(previousVolumeKg, recentVolumeKg),
  };
}

function percentChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Average sessions per week across a dense bucket series. */
export function averageSessionsPerWeek(buckets: WeekBucket[]): number {
  if (buckets.length === 0) return 0;
  return sum(buckets.map((bucket) => bucket.sessionCount)) / buckets.length;
}

/**
 * Mean duration of the sessions in a bucket series, in seconds.
 *
 * Weighted by session count rather than averaging the weekly averages, which
 * would over-weight a week containing a single workout.
 */
export function averageSessionDuration(buckets: WeekBucket[]): number | null {
  const sessions = sum(buckets.map((bucket) => bucket.sessionCount));
  if (sessions === 0) return null;
  return sum(buckets.map((bucket) => bucket.durationSeconds)) / sessions;
}
