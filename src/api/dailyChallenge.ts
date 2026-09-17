import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useMyProfile } from './profile';

import { useAuth } from '@/auth/AuthProvider';
import { localDayBounds, recentDayKeys, resolveTimezone, supportsTimeZones } from '@/lib/localDay';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';

type Challenge = Database['public']['Tables']['challenges']['Row'];
type ChallengeParticipantRow = Database['public']['Tables']['challenge_participants']['Row'];

/**
 * The Daily Challenge: train once today.
 *
 * WHY THIS IS NOT A NEW RULE TYPE
 * ------------------------------
 * It is a one-day personal `session_count` challenge, which
 * `score_challenge_for_user()` already knows how to score. Adding a `daily` rule
 * type would have meant a second scoring branch that could disagree with the
 * first about whether a session counted — exactly the drift the schema exists to
 * prevent. The template is a row in `challenge_templates`, which is how the engine
 * was designed to be extended.
 *
 * WHY IT IS PER MEMBER PER DAY, AND WHY THAT IS THE POINT
 * ------------------------------------------------------
 * Every member gets their own row, created on demand, with a window equal to
 * THEIR local day. That is what makes it work for everyone rather than for
 * whoever the demo data happened to favour:
 *
 *   * It is PERSONAL scope, so it does not depend on crew membership. The only
 *     challenge the seed used to create was crew-scoped, so anyone outside that
 *     crew saw nothing at all and had nothing to open.
 *   * The window comes from `profiles.timezone`, not the device clock, so a
 *     Vancouver member and a Toronto member each get their own correct day.
 *   * Nothing is keyed on a specific user id or requires a property some accounts
 *     lack: a member with no crew, no friends, and no history still gets today's
 *     challenge on first open.
 *
 * PROGRESS IS STILL NEVER COMPUTED HERE. This module creates the row, enrols the
 * member, asks the database to rescore, and reads the cached result back.
 */

const DAILY_TEMPLATE_KEY = 'daily_session';
const DAILY_TARGET = 1;

/** How many days of daily-challenge history the card reports on. */
export const DAILY_WINDOW_DAYS = 7;

/** Fallback copy, used when the template row cannot be read. */
const FALLBACK_NAME = 'Daily Challenge';
const FALLBACK_DESCRIPTION = 'Train once today. Resets tomorrow morning.';
const FALLBACK_EMOJI = '🔥';

export interface DailyChallengeDay {
  /** `YYYY-MM-DD` in the member's timezone. */
  dayKey: string;
  /** Null for a day the member never opened the app, so no row was ever created. */
  challenge: Challenge | null;
  progress: number;
  target: number;
  completed: boolean;
}

export interface DailyChallengeToday extends DailyChallengeDay {
  challenge: Challenge;
}

export interface DailyChallengeState {
  today: DailyChallengeToday;
  /** Most recent first, today included. Always `DAILY_WINDOW_DAYS` long. */
  history: DailyChallengeDay[];
  /** Days in `history` the member finished. */
  completedInWindow: number;
  windowDays: number;
  timezone: string;
  /**
   * False when the runtime's `Intl` ignores timezones, so the window follows the
   * device rather than the profile. Surfaced rather than hidden.
   */
  timezoneHonoured: boolean;
  /** When today's window opened and closes, as absolute instants. */
  startsAt: string;
  endsAt: string;
  emoji: string;
  name: string;
  description: string;
}

/**
 * Today's challenge, creating it if this is the member's first visit today.
 *
 * A GET-OR-CREATE INSIDE A QUERY, deliberately. The alternative — render an empty
 * state, then create the row from an effect — means the first paint after midnight
 * shows "no challenge today", which is the broken-looking screen this is meant to
 * remove. The write is idempotent, guarded by a unique index on
 * `(owner_id, template_key, rule->>'day')`, so running it from two devices at once
 * is safe: the loser gets a unique violation and re-reads.
 *
 * `enabled` waits for the profile, because the profile is where the timezone
 * comes from and guessing it would put the member in the wrong day.
 */
export function useDailyChallenge() {
  const { user } = useAuth();
  const { data: profile, isLoading: loadingProfile } = useMyProfile();

  const timezone = resolveTimezone(profile?.timezone);
  const bounds = localDayBounds(timezone);

  return useQuery({
    queryKey: queryKeys.dailyChallenge(bounds.dayKey),
    enabled: Boolean(user?.id) && !loadingProfile,
    // Short: a session finished on another screen should move this quickly.
    staleTime: 15_000,
    queryFn: async (): Promise<DailyChallengeState> => {
      const userId = user!.id;
      const dayKey = bounds.dayKey;

      const template = await readDailyTemplate();

      let today = await findDailyChallenge(userId, dayKey);
      if (!today) {
        today = await createDailyChallenge({
          userId,
          dayKey,
          timezone,
          startsAt: bounds.start,
          endsAt: bounds.end,
          emoji: template?.badge_emoji ?? FALLBACK_EMOJI,
          name: template?.name ?? FALLBACK_NAME,
          description: template?.description ?? FALLBACK_DESCRIPTION,
        });
      }

      await ensureParticipation(today.id, userId);

      // Progress is a cache that nothing refreshes when a session ends, so this
      // is what makes the number on screen true.
      await supabase.rpc('rescore_challenge', { p_challenge_id: today.id });

      const dayKeys = recentDayKeys(timezone, DAILY_WINDOW_DAYS);
      const recentChallenges = await readRecentDailyChallenges(userId, dayKeys.length);
      const participations = await readParticipations(
        userId,
        unique([today.id, ...recentChallenges.map((row) => row.id)]),
      );

      const byDay = new Map<string, Challenge>();
      for (const row of [today, ...recentChallenges]) {
        const day = dayOf(row);
        if (day && !byDay.has(day)) byDay.set(day, row);
      }

      const history: DailyChallengeDay[] = dayKeys.map((key) => {
        const challenge = byDay.get(key) ?? null;
        const participation = challenge ? participations.get(challenge.id) : undefined;
        const target = challenge ? Number(challenge.target) : DAILY_TARGET;
        const progress = Number(participation?.progress ?? 0);

        return {
          dayKey: key,
          challenge,
          progress,
          target,
          completed: participation?.completed_at != null || (target > 0 && progress >= target),
        };
      });

      const todayEntry = history.find((entry) => entry.dayKey === dayKey);
      const todayTarget = Number(today.target);
      const todayParticipation = participations.get(today.id);
      const todayProgress = Number(todayParticipation?.progress ?? todayEntry?.progress ?? 0);

      return {
        today: {
          dayKey,
          challenge: today,
          progress: todayProgress,
          target: todayTarget,
          completed:
            todayParticipation?.completed_at != null ||
            (todayTarget > 0 && todayProgress >= todayTarget),
        },
        history,
        completedInWindow: history.filter((entry) => entry.completed).length,
        windowDays: DAILY_WINDOW_DAYS,
        timezone,
        timezoneHonoured: supportsTimeZones(),
        startsAt: today.starts_at,
        endsAt: today.ends_at,
        emoji: today.badge_emoji ?? template?.badge_emoji ?? FALLBACK_EMOJI,
        name: today.name,
        description: today.description ?? template?.description ?? FALLBACK_DESCRIPTION,
      };
    },
  });
}

/**
 * Rescores today's challenge and refreshes it.
 *
 * Exposed so finishing a workout can push the number forward immediately rather
 * than waiting for a stale-time window to lapse.
 */
export function useRefreshDailyChallenge() {
  const { user } = useAuth();
  const { data: profile } = useMyProfile();
  const client = useQueryClient();

  const timezone = resolveTimezone(profile?.timezone);

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return;
      const dayKey = localDayBounds(timezone).dayKey;

      const today = await findDailyChallenge(user.id, dayKey);
      if (!today) return;

      await ensureParticipation(today.id, user.id);
      await supabase.rpc('rescore_challenge', { p_challenge_id: today.id });
    },
    onSettled: () => {
      // Invalidated by prefix so a day rollover mid-workout still lands.
      client.invalidateQueries({ queryKey: ['challenges', 'daily'] });
      client.invalidateQueries({ queryKey: queryKeys.myChallenges() });
    },
  });
}

/** True for a challenge produced by the daily template. */
export function isDailyChallenge(challenge: Pick<Challenge, 'template_key'>): boolean {
  return challenge.template_key === DAILY_TEMPLATE_KEY;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function readDailyTemplate() {
  const { data, error } = await supabase
    .from('challenge_templates')
    .select('key, name, description, badge_emoji')
    .eq('key', DAILY_TEMPLATE_KEY)
    .maybeSingle();

  // A missing template is not fatal — the copy falls back to constants — so a
  // read failure here must not take the whole screen down with it.
  if (error) return null;
  return data;
}

async function findDailyChallenge(userId: string, dayKey: string): Promise<Challenge | null> {
  const rows = await readRecentDailyChallenges(userId, 3);
  return rows.find((row) => dayOf(row) === dayKey) ?? null;
}

/**
 * The member's recent daily challenges.
 *
 * Filtered by `starts_at` and matched on the rule's day in JavaScript rather than
 * with a PostgREST `rule->>day` filter: the generated types only know real
 * columns, so a JSON-path filter would have to be cast past the type system for
 * no benefit at this row count.
 */
async function readRecentDailyChallenges(userId: string, days: number): Promise<Challenge[]> {
  // Two days of slack either side absorbs timezone offsets, so a challenge whose
  // window opened "yesterday" in UTC terms is still found.
  const since = new Date(Date.now() - (days + 2) * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('owner_id', userId)
    .eq('template_key', DAILY_TEMPLATE_KEY)
    .gte('starts_at', since)
    .order('starts_at', { ascending: false })
    .limit(days + 4);
  if (error) throw error;

  return data ?? [];
}

async function createDailyChallenge(input: {
  userId: string;
  dayKey: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  emoji: string;
  name: string;
  description: string;
}): Promise<Challenge> {
  const rule: Json = { target: DAILY_TARGET, day: input.dayKey };

  const { data, error } = await supabase
    .from('challenges')
    .insert({
      template_key: DAILY_TEMPLATE_KEY,
      scope: 'personal',
      crew_id: null,
      owner_id: input.userId,
      name: input.name,
      description: input.description,
      rule_type: 'session_count',
      rule,
      target: DAILY_TARGET,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      // The member's own zone: a personal challenge scored against a clock they
      // do not live in is not a challenge they can act on.
      timezone: input.timezone,
      visibility: 'private',
      // No badge key on purpose. A badge awarded every day stops meaning
      // anything, and `rescore_challenge` skips the award when it is null.
      badge_key: null,
      badge_emoji: input.emoji,
      created_by: input.userId,
    })
    .select()
    .single();

  if (!error) return data;

  // Lost the race against another device. The unique index did its job; re-read.
  if (error.code === '23505') {
    const existing = await findDailyChallenge(input.userId, input.dayKey);
    if (existing) return existing;
  }

  throw error;
}

async function ensureParticipation(challengeId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('challenge_participants')
    .insert({ challenge_id: challengeId, user_id: userId });

  // Already enrolled, which is the normal case on every visit after the first.
  if (error && error.code !== '23505') throw error;
}

async function readParticipations(
  userId: string,
  challengeIds: string[],
): Promise<Map<string, ChallengeParticipantRow>> {
  if (challengeIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('challenge_participants')
    .select('*')
    .eq('user_id', userId)
    .in('challenge_id', challengeIds);
  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.challenge_id, row]));
}

/** The local day a daily challenge belongs to, taken from its rule. */
function dayOf(challenge: Challenge): string | null {
  const rule = challenge.rule;
  if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) return null;

  const day = (rule as { [key: string]: Json | undefined }).day;
  return typeof day === 'string' && day.length > 0 ? day : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
