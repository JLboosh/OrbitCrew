import type { Database, Json } from '@/types/database.types';

export type ChallengeRuleType = Database['public']['Enums']['challenge_rule_type'];

/**
 * Presentation helpers for the template-driven challenge engine.
 *
 * SCORING IS NOT DUPLICATED HERE. `score_challenge_for_user()` in the database is
 * the single source of truth for progress, and this module only turns a rule into
 * words and formats a number the database already computed. Re-implementing any
 * of the counting logic in JavaScript would let the app and the engine disagree
 * about whether a member finished a challenge, which is exactly the drift the
 * schema was designed to prevent.
 */

export interface ChallengeRuleParams {
  target: number | null;
  sessionsPerWeek: number | null;
  weeks: number | null;
  startHour: number | null;
  endHour: number | null;
  exerciseId: string | null;
}

const EMPTY_PARAMS: ChallengeRuleParams = {
  target: null,
  sessionsPerWeek: null,
  weeks: null,
  startHour: null,
  endHour: null,
  exerciseId: null,
};

/**
 * Reads the JSONB rule into a typed shape.
 *
 * Defensive because `rule` is free-form JSON by design — that is what makes a new
 * challenge type an INSERT rather than a migration. A malformed or partial rule
 * must degrade to "unknown" rather than crash a screen.
 */
export function parseChallengeRule(rule: Json | null | undefined): ChallengeRuleParams {
  if (rule == null || typeof rule !== 'object' || Array.isArray(rule)) return EMPTY_PARAMS;

  const record = rule as { [key: string]: Json | undefined };

  return {
    target: numberOrNull(record.target),
    sessionsPerWeek: numberOrNull(record.sessions_per_week),
    weeks: numberOrNull(record.weeks),
    startHour: numberOrNull(record.start_hour),
    endHour: numberOrNull(record.end_hour),
    exerciseId: typeof record.exercise_id === 'string' ? record.exercise_id : null,
  };
}

function numberOrNull(value: Json | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The noun a progress counter is measured in, for progress bars and labels. */
export function challengeUnit(ruleType: ChallengeRuleType): string {
  switch (ruleType) {
    case 'session_count':
    case 'crew_session_total':
      return 'sessions';
    case 'distinct_gyms':
      return 'gyms';
    case 'time_of_day':
      return 'sessions';
    case 'weekly_consistency':
      return 'weeks';
    case 'exercise_1rm_gain':
      return '%';
  }
}

/**
 * Formats a progress value against its target.
 *
 * The 1RM-gain rule is a percentage rather than a count, so it must not be shown
 * as "3 / 5 %"-style nonsense.
 */
export function formatChallengeProgress(
  ruleType: ChallengeRuleType,
  progress: number,
  target: number,
): string {
  if (ruleType === 'exercise_1rm_gain') {
    return `${round1(progress)}% of ${round1(target)}%`;
  }
  const unit = challengeUnit(ruleType);
  return `${round1(progress)} / ${round1(target)} ${unit}`;
}

function round1(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

/**
 * Plain-language description of what a challenge asks for.
 *
 * Written out rather than stored as prose on the template so a challenge created
 * with overridden parameters still describes itself accurately: change the target
 * from 3 gyms to 5 and the wording follows.
 */
export function describeChallengeRule(
  ruleType: ChallengeRuleType,
  rule: Json | null | undefined,
  target: number,
  exerciseName?: string | null,
): string {
  const params = parseChallengeRule(rule);

  switch (ruleType) {
    case 'session_count':
      return `Complete ${plural(target, 'session')}.`;

    case 'crew_session_total':
      return `Your crew collectively completes ${plural(target, 'session')}.`;

    case 'distinct_gyms':
      return `Train at ${plural(target, 'different gym')}.`;

    case 'weekly_consistency': {
      const perWeek = params.sessionsPerWeek ?? 3;
      const weeks = params.weeks ?? target;
      return `Complete ${plural(perWeek, 'session')} a week for ${plural(weeks, 'week')}.`;
    }

    case 'time_of_day':
      return `Complete ${plural(target, 'session')} ${describeHourWindow(
        params.startHour,
        params.endHour,
      )}.`;

    case 'exercise_1rm_gain': {
      const subject = exerciseName ? `your ${exerciseName}` : "an exercise's";
      return `Improve ${subject} estimated one-rep max by ${round1(target)}%.`;
    }
  }
}

/** "before 9 AM", "between 3 PM and 7 PM", "at any time". */
export function describeHourWindow(startHour: number | null, endHour: number | null): string {
  const start = startHour ?? 0;
  const end = endHour ?? 24;

  if (start <= 0 && end >= 24) return 'at any time';
  if (start <= 0) return `before ${hourLabel(end)}`;
  if (end >= 24) return `after ${hourLabel(start)}`;
  return `between ${hourLabel(start)} and ${hourLabel(end)}`;
}

/** 0 -> "12 AM", 9 -> "9 AM", 15 -> "3 PM", 24 -> "12 AM". */
export function hourLabel(hour: number): string {
  const normalised = ((Math.round(hour) % 24) + 24) % 24;
  const suffix = normalised < 12 ? 'AM' : 'PM';
  const twelve = normalised % 12 === 0 ? 12 : normalised % 12;
  return `${twelve} ${suffix}`;
}

/**
 * What makes a session count, stated plainly.
 *
 * Surfaced in the UI because members reasonably ask why a workout did not move
 * their counter. The threshold is the crew's `min_session_minutes` for crew
 * challenges and 20 minutes for personal ones, matching the engine.
 */
export function describeQualification(minSessionMinutes: number | null | undefined): string {
  const minutes = minSessionMinutes ?? 20;
  return `Finished sessions of at least ${minutes} minutes count.`;
}

/**
 * Whether a rule is time-of-day sensitive, and therefore whether the challenge's
 * timezone matters to the member.
 */
export function isTimezoneSensitive(ruleType: ChallengeRuleType): boolean {
  return ruleType === 'time_of_day' || ruleType === 'weekly_consistency';
}

/**
 * Whether progress on this rule is a shared total across the crew rather than a
 * per-member figure. Crew totals must be presented as combined progress, since
 * that is how the engine judges completion.
 */
export function isCombinedProgress(ruleType: ChallengeRuleType): boolean {
  return ruleType === 'crew_session_total';
}

function plural(count: number, noun: string): string {
  const shown = round1(count);
  return `${shown} ${count === 1 ? noun : `${noun}s`}`;
}

/** Days remaining, floored at zero. Null when the window has no end in view. */
export function daysRemaining(endsAt: string, now: Date = new Date()): number {
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export type ChallengeStatus = 'upcoming' | 'active' | 'ended';

export function challengeStatus(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): ChallengeStatus {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const current = now.getTime();

  if (Number.isFinite(start) && current < start) return 'upcoming';
  if (Number.isFinite(end) && current >= end) return 'ended';
  return 'active';
}
