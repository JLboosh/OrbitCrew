import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { parseChallengeRule, type ChallengeRuleType } from '@/lib/challengeRules';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';

export type ChallengeTemplate = Database['public']['Tables']['challenge_templates']['Row'];
export type Challenge = Database['public']['Tables']['challenges']['Row'];
export type ChallengeParticipantRow = Database['public']['Tables']['challenge_participants']['Row'];
export type ChallengeScope = Database['public']['Enums']['challenge_scope'];
export type ChallengeVisibility = Database['public']['Enums']['challenge_visibility'];

/**
 * Challenges: a template-driven engine, not hard-coded challenge types.
 *
 * A challenge is a row referencing a TEMPLATE (how to score) plus a JSONB rule
 * (the parameters). Adding "complete 4 sessions a week for 6 weeks" is an INSERT,
 * not a migration and an app release. One database function,
 * `score_challenge_for_user()`, interprets every rule type, so personal and crew
 * challenges are scored by identical logic and cannot drift apart.
 *
 * PROGRESS IS NEVER COMPUTED HERE. `challenge_participants.progress` is a cache
 * refreshed by `rescore_challenge()`, and the authoritative value is always
 * recomputable from sessions. This module reads that cache and asks the database
 * to refresh it; it never counts sessions itself.
 *
 * PARTICIPATION IS ALWAYS OPT-IN. A member enrols themselves — the insert policy
 * requires `user_id = auth.uid()`, so an admin cannot conscript someone into a
 * challenge they did not choose.
 */

/** The seeded catalogue. Six templates ship with the schema. */
export function useChallengeTemplates() {
  return useQuery({
    queryKey: queryKeys.challengeTemplates(),
    // A catalogue that only changes when someone inserts a new template.
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<ChallengeTemplate[]> => {
      const { data, error } = await supabase
        .from('challenge_templates')
        .select('*')
        .order('default_scope')
        .order('name');
      if (error) throw error;
      return data;
    },
  });
}

export interface MyChallenge extends ChallengeParticipantRow {
  challenge: Challenge | null;
}

/**
 * Challenges the member has joined, with their cached progress.
 *
 * Driven from `challenge_participants` rather than `challenges` because
 * participation is the thing that matters to the member, and the join carries
 * their progress and completion timestamp in the same row.
 */
export function useMyChallenges() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.myChallenges(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<MyChallenge[]> => {
      const { data, error } = await supabase
        .from('challenge_participants')
        .select('*, challenge:challenges ( * )')
        .eq('user_id', user!.id)
        .order('joined_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MyChallenge[];
    },
  });
}

/**
 * Every crew challenge the member can see, across all their crews.
 *
 * No crew filter is applied in the query: the `challenges` SELECT policy already
 * restricts rows to crews the caller belongs to. Filtering again in the client
 * would duplicate an authorisation decision that belongs in one place.
 */
export function useVisibleCrewChallenges() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.joinableChallenges(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Challenge[]> => {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .not('crew_id', 'is', null)
        .order('ends_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Challenges belonging to one crew. */
export function useCrewChallenges(crewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crewChallenges(crewId ?? 'none'),
    enabled: Boolean(crewId),
    queryFn: async (): Promise<Challenge[]> => {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('crew_id', crewId!)
        .order('ends_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export interface ChallengeWithTemplate extends Challenge {
  template: Pick<ChallengeTemplate, 'key' | 'name' | 'description' | 'badge_emoji'> | null;
}

export function useChallenge(challengeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.challenge(challengeId ?? 'none'),
    enabled: Boolean(challengeId),
    queryFn: async (): Promise<ChallengeWithTemplate | null> => {
      const { data, error } = await supabase
        .from('challenges')
        .select('*, template:challenge_templates ( key, name, description, badge_emoji )')
        .eq('id', challengeId!)
        .maybeSingle();
      if (error) throw error;
      return (data as ChallengeWithTemplate | null) ?? null;
    },
  });
}

export interface ChallengeParticipant extends ChallengeParticipantRow {
  profile: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
}

/**
 * Participants and their progress, best first.
 *
 * For a crew challenge every member of that crew is visible; for a personal one
 * only the member's own row comes back. That asymmetry is the RLS policy doing its
 * job, so the same hook is safe on both.
 */
export function useChallengeParticipants(challengeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.challengeParticipants(challengeId ?? 'none'),
    enabled: Boolean(challengeId),
    queryFn: async (): Promise<ChallengeParticipant[]> => {
      const { data, error } = await supabase
        .from('challenge_participants')
        .select('*, profile:profiles ( id, username, display_name, avatar_url )')
        .eq('challenge_id', challengeId!)
        .order('progress', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ChallengeParticipant[];
    },
  });
}

export interface EarnedBadge {
  badgeKey: string;
  name: string;
  emoji: string | null;
  description: string | null;
  awardedAt: string;
  challengeId: string | null;
}

/**
 * Badges the member has earned. Awarded only by the scoring engine.
 *
 * Flattened into a plain shape here rather than handed to screens as a nested
 * PostgREST result. Embedded relations arrive as an object for a to-one join and
 * an array for a to-many one, and which of those the generated types infer is not
 * something a screen should have to care about — or break over.
 */
export function useMyBadges() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.myBadges(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<EarnedBadge[]> => {
      const { data, error } = await supabase
        .from('user_badges')
        .select(
          'badge_key, awarded_at, challenge_id, badge:badges ( key, name, description, emoji )',
        )
        .eq('user_id', user!.id)
        .order('awarded_at', { ascending: false });
      if (error) throw error;

      return (data ?? []).map((row) => {
        const badge = firstOf(row.badge);
        return {
          badgeKey: row.badge_key,
          // Falls back to the key so a badge row that lost its catalogue entry
          // still renders as something rather than an empty gap.
          name: badge?.name ?? row.badge_key,
          emoji: badge?.emoji ?? null,
          description: badge?.description ?? null,
          awardedAt: row.awarded_at,
          challengeId: row.challenge_id,
        };
      });
    },
  });
}

/** Normalises a PostgREST embedded relation that may be an object or an array. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

export interface CreateChallengeInput {
  template: ChallengeTemplate;
  scope: ChallengeScope;
  /** Required when scope is 'crew'. The caller must be an admin of it. */
  crewId?: string | null;
  /**
   * Timezone the challenge is scored in: the CREW's for a crew challenge, the
   * member's for a personal one, so nobody is judged against a clock they do not
   * live in. Required rather than defaulted, because silently falling back to UTC
   * would quietly mis-score every time-of-day challenge.
   */
  timezone: string;
  /** Overrides the template default. */
  target?: number;
  durationDays?: number;
  startsAt?: Date;
  visibility?: ChallengeVisibility;
  /** Required for the `exercise_1rm_gain` rule; ignored otherwise. */
  exerciseId?: string | null;
  name?: string;
  /** Defaults to true: creating a challenge you are not in makes little sense. */
  autoJoin?: boolean;
}

/**
 * Creates a challenge from a template and, by default, joins it.
 *
 * Crew challenges are admin-only, enforced by the
 * `challenges_insert_crew_admin` policy — the UI should only offer the option for
 * crews where the member is owner or admin, but the database is what guarantees
 * it.
 *
 * The freshly created challenge is rescored immediately so it opens showing real
 * progress. That matters more than it sounds: a member who has already trained
 * twice this week should see 2/3, not 0/3, or the challenge looks broken.
 */
export function useCreateChallenge() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateChallengeInput): Promise<Challenge> => {
      const {
        template,
        scope,
        crewId = null,
        timezone,
        visibility,
        exerciseId = null,
        autoJoin = true,
      } = input;

      if (scope === 'crew' && !crewId) {
        throw new Error('A crew challenge needs a crew.');
      }
      if (template.rule_type === 'exercise_1rm_gain' && !exerciseId) {
        throw new Error('Choose an exercise for a strength challenge.');
      }

      const defaults = parseChallengeRule(template.default_rule);
      const target = firstPositive(input.target, defaults.target) ?? 1;

      const name = (input.name ?? template.name).trim();
      if (name.length < 2 || name.length > 100) {
        throw new Error('Give the challenge a name between 2 and 100 characters.');
      }

      const startsAt = input.startsAt ?? new Date();
      // The schema permits up to 400 days; templates cap at 365, so match that.
      const durationDays = clamp(input.durationDays ?? template.default_duration_days, 1, 365);
      const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from('challenges')
        .insert({
          template_key: template.key,
          scope,
          crew_id: scope === 'crew' ? crewId : null,
          owner_id: scope === 'personal' ? user!.id : null,
          name,
          description: template.description,
          rule_type: template.rule_type,
          rule: buildRule(template.default_rule, target, exerciseId),
          target,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          timezone,
          // Personal challenges default to private; crew challenges to the crew.
          visibility: visibility ?? (scope === 'crew' ? 'crew' : 'private'),
          badge_key: template.badge_key,
          badge_emoji: template.badge_emoji,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;

      if (autoJoin) {
        const { error: joinError } = await supabase
          .from('challenge_participants')
          .insert({ challenge_id: data.id, user_id: user!.id });
        if (joinError) throw joinError;

        await supabase.rpc('rescore_challenge', { p_challenge_id: data.id });
      }

      return data;
    },
    onSuccess: (challenge) => {
      invalidateChallengeQueries(client, challenge.id, challenge.crew_id);
    },
  });
}

/**
 * Joins an existing challenge and scores the member straight away.
 *
 * NOTE for whoever tightens RLS next: `challenge_participants_insert_self` checks
 * only that the row is the caller's own, not that the challenge is one they can
 * see. Someone who learned a challenge UUID could therefore enrol in it. Low
 * impact — they would appear in a crew's participant list without being able to
 * read the challenge — but the policy should also require
 * `caller_in_crew(challenge.crew_id)` or ownership.
 */
export function useJoinChallenge() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (challenge: Pick<Challenge, 'id' | 'crew_id'>) => {
      const { error } = await supabase
        .from('challenge_participants')
        .insert({ challenge_id: challenge.id, user_id: user!.id });
      if (error) throw error;

      await supabase.rpc('rescore_challenge', { p_challenge_id: challenge.id });
      return challenge;
    },
    onSuccess: (challenge) => {
      invalidateChallengeQueries(client, challenge.id, challenge.crew_id);
    },
  });
}

/** Leaves a challenge. Deletes the participation row, keeping the challenge. */
export function useLeaveChallenge() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (challenge: Pick<Challenge, 'id' | 'crew_id'>) => {
      const { error } = await supabase
        .from('challenge_participants')
        .delete()
        .eq('challenge_id', challenge.id)
        .eq('user_id', user!.id);
      if (error) throw error;
      return challenge;
    },
    onSuccess: (challenge) => {
      invalidateChallengeQueries(client, challenge.id, challenge.crew_id);
    },
  });
}

/**
 * Recomputes progress for every participant and awards any earned badges.
 *
 * Idempotent, so it is safe to call on screen open. Worth doing: progress is a
 * cache, and nothing recalculates it automatically when a session ends.
 */
export function useRescoreChallenge() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (challenge: Pick<Challenge, 'id' | 'crew_id'>) => {
      const { error } = await supabase.rpc('rescore_challenge', { p_challenge_id: challenge.id });
      if (error) throw error;
      return challenge;
    },
    onSuccess: (challenge) => {
      invalidateChallengeQueries(client, challenge.id, challenge.crew_id);
    },
  });
}

/** Deletes a challenge. Permitted for its owner, or an admin of its crew. */
export function useDeleteChallenge() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (challenge: Pick<Challenge, 'id' | 'crew_id'>) => {
      const { error } = await supabase.from('challenges').delete().eq('id', challenge.id);
      if (error) throw error;
      return challenge;
    },
    onSuccess: (challenge) => {
      invalidateChallengeQueries(client, challenge.id, challenge.crew_id);
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combined progress across participants.
 *
 * Only meaningful for `crew_session_total`, where the engine judges completion on
 * the group's total rather than any individual's. Using it for other rule types
 * would invent a metric the database does not score.
 */
export function combinedProgress(participants: ChallengeParticipantRow[]): number {
  return participants.reduce((total, participant) => total + Number(participant.progress), 0);
}

/** Merges the template's default rule with the chosen target and exercise. */
function buildRule(defaultRule: Json | null, target: number, exerciseId: string | null): Json {
  const record: { [key: string]: Json | undefined } =
    defaultRule != null && typeof defaultRule === 'object' && !Array.isArray(defaultRule)
      ? { ...defaultRule }
      : {};

  record.target = target;
  if (exerciseId) record.exercise_id = exerciseId;

  return record;
}

function firstPositive(...values: (number | null | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

function invalidateChallengeQueries(
  client: ReturnType<typeof useQueryClient>,
  challengeId: string,
  crewId: string | null,
): void {
  client.invalidateQueries({ queryKey: queryKeys.myChallenges() });
  client.invalidateQueries({ queryKey: queryKeys.joinableChallenges() });
  client.invalidateQueries({ queryKey: queryKeys.challenge(challengeId) });
  client.invalidateQueries({ queryKey: queryKeys.challengeParticipants(challengeId) });
  client.invalidateQueries({ queryKey: queryKeys.myBadges() });
  if (crewId) {
    client.invalidateQueries({ queryKey: queryKeys.crewChallenges(crewId) });
  }
}

/** Re-exported so screens import rule types from one place. */
export type { ChallengeRuleType };
