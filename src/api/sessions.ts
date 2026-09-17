import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Session = Database['public']['Tables']['sessions']['Row'];
export type Exercise = Database['public']['Tables']['exercises']['Row'];
export type SessionExercise = Database['public']['Tables']['session_exercises']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];
export type WeightUnit = Database['public']['Enums']['weight_unit'];
export type MuscleGroup = Database['public']['Enums']['muscle_group'];
export type ExerciseEquipment = Database['public']['Enums']['exercise_equipment'];

/** The exercise fields every logging surface needs. */
export type ExerciseSummary = Pick<
  Exercise,
  'id' | 'name' | 'primary_muscle' | 'equipment' | 'is_weighted'
>;

/** A session with its exercises and sets, shaped for the Active Session screen. */
export interface SessionDetail extends Session {
  session_exercises: (SessionExercise & {
    exercise: ExerciseSummary;
    sets: SetRow[];
  })[];
}

const SESSION_DETAIL_SELECT = `
  *,
  session_exercises (
    *,
    exercise:exercises ( id, name, primary_muscle, equipment, is_weighted ),
    sets ( * )
  )
`;

/**
 * The member's in-progress session, if any.
 *
 * A unique partial index guarantees at most one, so `maybeSingle` is correct and
 * an "already training" state cannot be ambiguous.
 */
export function useActiveSession() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.activeSession(),
    enabled: Boolean(user?.id),
    // Kept fresh because the Today screen shows a running timer against it.
    staleTime: 5_000,
    queryFn: async (): Promise<SessionDetail | null> => {
      const { data, error } = await supabase
        .from('sessions')
        .select(SESSION_DETAIL_SELECT)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as SessionDetail | null) ?? null;
    },
  });
}

/** Recent finished sessions, newest first. */
export function useRecentSessions(limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...queryKeys.sessions(), limit],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<Session[]> => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
  });
}

/** A finished session plus what it needs to describe itself in a list. */
export interface WorkoutSummary extends Session {
  exerciseCount: number;
  setCount: number;
  /** Primary muscle of each exercise, used to label sessions that predate workout types. */
  muscles: MuscleGroup[];
  exerciseNames: string[];
}

/**
 * Recent finished workouts, with enough shape to render a history row.
 *
 * One query rather than a session list plus a lookup per row: the exercise names
 * and muscle groups come back embedded, which is also what lets a session logged
 * before `workout_categories` existed still show a workout type — inferred from
 * the muscles it actually trained. See `sessionCategoryKeys`.
 */
export function useRecentWorkouts(limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...queryKeys.sessions(), 'workouts', limit],
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<WorkoutSummary[]> => {
      const { data, error } = await supabase
        .from('sessions')
        .select(
          `*,
           session_exercises (
             id,
             exercise:exercises ( id, name, primary_muscle ),
             sets ( id )
           )`,
        )
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      return (data ?? []).map((row) => {
        const entries = row.session_exercises ?? [];
        return {
          ...row,
          exerciseCount: entries.length,
          setCount: entries.reduce((total, entry) => total + (entry.sets?.length ?? 0), 0),
          muscles: entries.flatMap((entry) =>
            entry.exercise?.primary_muscle ? [entry.exercise.primary_muscle] : [],
          ),
          exerciseNames: entries.flatMap((entry) =>
            entry.exercise?.name ? [entry.exercise.name] : [],
          ),
        };
      });
    },
  });
}

/** One finished session in full, for the history detail screen. */
export function useSession(sessionId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.session(sessionId ?? 'none'),
    enabled: Boolean(sessionId && user?.id),
    queryFn: async (): Promise<SessionDetail | null> => {
      const { data, error } = await supabase
        .from('sessions')
        .select(SESSION_DETAIL_SELECT)
        .eq('id', sessionId!)
        .maybeSingle();
      if (error) throw error;
      return (data as SessionDetail | null) ?? null;
    },
  });
}

/**
 * Starts a session, optionally at a gym and with the workout type already chosen.
 *
 * The categories are written on the INSERT rather than patched afterwards, so a
 * session never exists in a state where the member has picked "Chest + Triceps"
 * but the row does not know it — which is the state a crash or a closed tab
 * between two writes would leave behind.
 */
export function useStartSession() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { gymId?: string | null; workoutCategories?: string[] } = {}) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: user!.id,
          gym_id: input.gymId ?? null,
          workout_categories: input.workoutCategories ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

/** Changes the workout type mid-session, e.g. after adding an unplanned exercise. */
export function useUpdateWorkoutCategories() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      workoutCategories,
    }: {
      sessionId: string;
      workoutCategories: string[];
    }) => {
      const { error } = await supabase
        .from('sessions')
        .update({ workout_categories: workoutCategories })
        .eq('id', sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

/**
 * Ends the active session.
 *
 * Calls the `end_session` RPC rather than updating `ended_at` directly, so the
 * end time comes from the server clock. A client-supplied timestamp could be
 * used to inflate duration and manufacture a session that counts toward a crew
 * goal.
 */
export function useEndSession() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (sessionId?: string) => endSessionRpc(sessionId),
    onSuccess: () => {
      invalidateAfterWorkout(client);
    },
  });
}

/**
 * Calls `end_session` and returns the updated row.
 *
 * THE ASSERTION IS NOT LAZINESS. The function is declared `RETURNS
 * public.sessions`, and the generated types say so — but this version of
 * supabase-js does not resolve a `SetofOptions` return reached through `.single()`
 * back to the table's Row, so the result lands as `never`. That is true of the
 * pristine generated types as well, so it is not something the local type
 * extension introduced and not something a regeneration will fix.
 *
 * Asserted once, here, rather than at each call site, and the shape is guaranteed
 * by the migration rather than assumed.
 */
async function endSessionRpc(sessionId?: string): Promise<Session> {
  const { data, error } = await supabase
    .rpc('end_session', { p_session_id: sessionId ?? undefined })
    .single();
  if (error) throw error;
  return data as unknown as Session;
}

/** What the member is shown the moment a workout ends. */
export interface FinishedWorkout {
  session: Session;
  workoutCategories: string[];
  durationSeconds: number | null;
  exerciseCount: number;
  setCount: number;
  /** Challenges rescored as a direct result of this workout. */
  rescoredChallengeIds: string[];
}

/**
 * Ends the workout and makes every downstream number catch up.
 *
 * WHY THIS IS ONE MUTATION AND NOT "end, then hope"
 * -------------------------------------------------
 * Finishing a workout is the moment the whole product is supposed to react:
 * progress charts, personal records, the crew's weekly goal, the leaderboard, and
 * every challenge the member is in. Two of those need more than a cache
 * invalidation:
 *
 *   * `challenge_participants.progress` is a CACHE. Nothing recalculates it when a
 *     session ends, so a member who just trained would open a challenge still
 *     showing yesterday's number and reasonably conclude it was broken. Every
 *     active challenge they are in is rescored here, by the database, using the
 *     same `score_challenge_for_user()` as everything else — no counting happens
 *     in this file.
 *   * Presence is cleared by a trigger on `ended_at`, so the presence cache is
 *     stale the instant this returns.
 *
 * Personal records and volume need nothing extra: PRs are trigger-maintained and
 * the aggregates are computed on read, so invalidating is enough.
 *
 * A rescore failure does NOT fail the workout. The session is already saved and
 * the numbers are recomputable; losing the workout to make a cache refresh
 * succeed would be the wrong trade.
 */
export function useFinishWorkout() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (session: SessionDetail): Promise<FinishedWorkout> => {
      const ended = await endSessionRpc(session.id);

      const rescoredChallengeIds = user?.id ? await rescoreActiveChallenges(user.id) : [];

      const entries = session.session_exercises ?? [];

      return {
        session: ended,
        workoutCategories: session.workout_categories ?? [],
        durationSeconds: ended.duration_seconds,
        exerciseCount: entries.length,
        setCount: entries.reduce((total, entry) => total + (entry.sets?.length ?? 0), 0),
        rescoredChallengeIds,
      };
    },
    onSuccess: () => {
      invalidateAfterWorkout(client);
    },
  });
}

/**
 * Rescores every challenge the member is currently in, and reports which.
 *
 * Bounded to twenty: the query is one round trip but each rescore is another, and
 * a member with a pathological number of challenges should not turn "Finish
 * workout" into a thirty-second wait. Anything beyond the cap is picked up by the
 * rescore-on-open that challenge screens already perform.
 */
async function rescoreActiveChallenges(userId: string): Promise<string[]> {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('challenge_participants')
    .select('challenge_id, challenge:challenges ( id, starts_at, ends_at )')
    .eq('user_id', userId)
    .limit(50);

  // A failure here must not fail the workout; the sets are already saved.
  if (error) return [];

  const active = (data ?? [])
    .flatMap((row) => (row.challenge ? [row.challenge] : []))
    .filter((challenge) => challenge.starts_at <= nowIso && challenge.ends_at > nowIso)
    .slice(0, 20);

  const rescored: string[] = [];
  for (const challenge of active) {
    const { error: rescoreError } = await supabase.rpc('rescore_challenge', {
      p_challenge_id: challenge.id,
    });
    if (!rescoreError) rescored.push(challenge.id);
  }

  return rescored;
}

/**
 * Everything a finished workout changes.
 *
 * Listed in one place because the failure mode of forgetting one is silent: a
 * correct database and a screen showing yesterday's figure.
 */
function invalidateAfterWorkout(client: ReturnType<typeof useQueryClient>): void {
  client.invalidateQueries({ queryKey: queryKeys.activeSession() });
  client.invalidateQueries({ queryKey: queryKeys.sessions() });

  // Ending a session clears presence via trigger. `['presence']` covers the
  // per-gym occupancy key too, but `gymPresence(id)` is namespaced under `gym`.
  client.invalidateQueries({ queryKey: queryKeys.presence() });
  client.invalidateQueries({ queryKey: ['gym'] });

  /*
   * Crew weekly goal and leaderboard both count sessions.
   *
   * BOTH prefixes are needed, and the missing one was a real bug. `queryKeys.crews()`
   * is `['crews']` — the member's crew LIST — while the goal and the leaderboard are
   * `['crew', id, 'progress']` and `['crew', id, 'leaderboard', n]`. React Query
   * matches keys by prefix, and `['crews']` is not a prefix of `['crew', ...]`, so
   * finishing a workout previously refreshed neither. The crew goal on the Today
   * screen stayed at its old number until something else happened to refetch it,
   * which read exactly like the session not counting.
   */
  client.invalidateQueries({ queryKey: queryKeys.crews() });
  client.invalidateQueries({ queryKey: ['crew'] });

  // Progress: streak, weekly summary, per-exercise 1RM, personal records.
  client.invalidateQueries({ queryKey: ['progress'] });

  // Challenges: the rescore above changed cached progress, and a completion may
  // have awarded a badge.
  client.invalidateQueries({ queryKey: ['challenges'] });
  client.invalidateQueries({ queryKey: queryKeys.myBadges() });
}

export function useUpdateSessionNotes() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionId, notes }: { sessionId: string; notes: string }) => {
      const { error } = await supabase.from('sessions').update({ notes }).eq('id', sessionId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

/**
 * The exercise library: canonical entries plus the member's own custom ones.
 *
 * One query for both, because the RLS policy already returns exactly that union
 * (`created_by is null or created_by = auth.uid()`). Splitting it would duplicate
 * an authorisation decision that belongs in the database — and the member's custom
 * exercises need to sit alongside the canonical ones in the picker anyway.
 */
export function useExercises() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.exercises(),
    enabled: Boolean(user?.id),
    // Rarely changes, so cache it for the session rather than refetching.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Exercise[]> => {
      const { data, error } = await supabase.from('exercises').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });
}

export interface CreateCustomExerciseInput {
  name: string;
  primaryMuscle: MuscleGroup;
  equipment?: ExerciseEquipment;
  isWeighted?: boolean;
  /** Setup notes or cues. Optional, capped at 500 characters by the schema. */
  description?: string | null;
}

/**
 * Creates an exercise only this member can see.
 *
 * `created_by` is the caller, which is what the insert policy requires — so a
 * custom exercise can never leak into the shared canonical library. It is saved to
 * the account rather than the session, so it is there for every future workout,
 * and the exercise cache is invalidated so it appears in the picker immediately
 * rather than after a restart.
 *
 * A duplicate name is surfaced as a readable message: the partial unique index on
 * `(created_by, lower(name))` is what makes a second "Landmine Press" impossible,
 * and its raw error text is not something worth showing anyone.
 */
export function useCreateCustomExercise() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCustomExerciseInput): Promise<Exercise> => {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 80) {
        throw new Error('Give the exercise a name between 2 and 80 characters.');
      }

      const { data, error } = await supabase
        .from('exercises')
        .insert({
          name,
          primary_muscle: input.primaryMuscle,
          equipment: input.equipment ?? 'other',
          is_weighted: input.isWeighted ?? true,
          description: input.description?.trim() || null,
          created_by: user!.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error(`You already have an exercise called ${name}.`);
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.exercises() });
    },
  });
}

/** Removes one of the member's own custom exercises. */
export function useDeleteCustomExercise() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (exerciseId: string) => {
      const { error } = await supabase.from('exercises').delete().eq('id', exerciseId);
      if (error) {
        // `session_exercises.exercise_id` is ON DELETE RESTRICT precisely so
        // history is never rewritten by a library tidy-up.
        if (error.code === '23503') {
          throw new Error('That exercise is used in a logged workout, so it cannot be deleted.');
        }
        throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.exercises() });
    },
  });
}

/** Adds an exercise to a session, appended at the end. */
export function useAddSessionExercise() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      exerciseId,
      orderIndex,
    }: {
      sessionId: string;
      exerciseId: string;
      orderIndex: number;
    }) => {
      const { data, error } = await supabase
        .from('session_exercises')
        .insert({ session_id: sessionId, exercise_id: exerciseId, order_index: orderIndex })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

export function useRemoveSessionExercise() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (sessionExerciseId: string) => {
      const { error } = await supabase
        .from('session_exercises')
        .delete()
        .eq('id', sessionExerciseId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

export interface LogSetInput {
  sessionExerciseId: string;
  setIndex: number;
  weight?: number | null;
  weightUnit?: WeightUnit;
  reps?: number | null;
  rpe?: number | null;
  isWarmup?: boolean;
  durationSeconds?: number | null;
}

/**
 * Logs a set.
 *
 * NOTE: every field is sent explicitly, including defaults. PostgREST builds a
 * bulk insert from the UNION of keys across rows and fills absent ones with
 * NULL rather than the column default — omitting `is_warmup` would violate its
 * NOT NULL constraint.
 *
 * `weight_kg` and `estimated_1rm_kg` are deliberately NOT sent: they are
 * generated columns, so the conversion and the Epley formula live only in the
 * database.
 */
export function useLogSet() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: LogSetInput) => {
      const { data, error } = await supabase
        .from('sets')
        .insert({
          session_exercise_id: input.sessionExerciseId,
          set_index: input.setIndex,
          weight: input.weight ?? null,
          weight_unit: input.weightUnit ?? 'lb',
          reps: input.reps ?? null,
          rpe: input.rpe ?? null,
          is_warmup: input.isWarmup ?? false,
          duration_seconds: input.durationSeconds ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

/**
 * Edits a set that is already logged.
 *
 * What makes the tracking screen a LIST OF EDITABLE ROWS rather than a form plus a
 * log button: tapping "Add set" writes the row immediately, pre-filled from the
 * previous one, and the member corrects the two numbers in place. That is the
 * difference between three taps per set and eight.
 *
 * `weight_kg` and `estimated_1rm_kg` are not sent — they are generated columns, so
 * editing a weight automatically re-derives the Epley estimate and any personal
 * record the trigger maintains from it.
 */
export function useUpdateSet() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      setId: string;
      weight?: number | null;
      weightUnit?: WeightUnit;
      reps?: number | null;
      isWarmup?: boolean;
      durationSeconds?: number | null;
    }) => {
      const patch: Database['public']['Tables']['sets']['Update'] = {};
      if (input.weight !== undefined) patch.weight = input.weight;
      if (input.weightUnit !== undefined) patch.weight_unit = input.weightUnit;
      if (input.reps !== undefined) patch.reps = input.reps;
      if (input.isWarmup !== undefined) patch.is_warmup = input.isWarmup;
      if (input.durationSeconds !== undefined) patch.duration_seconds = input.durationSeconds;

      const { error } = await supabase.from('sets').update(patch).eq('id', input.setId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

export function useDeleteSet() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (setId: string) => {
      const { error } = await supabase.from('sets').delete().eq('id', setId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

/** Notes against one exercise within a session, e.g. "belt on from set 3". */
export function useUpdateSessionExerciseNotes() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionExerciseId,
      notes,
    }: {
      sessionExerciseId: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from('session_exercises')
        .update({ notes: notes.trim() || null })
        .eq('id', sessionExerciseId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
    },
  });
}

// ---------------------------------------------------------------------------
// Presence (check in / check out)
// ---------------------------------------------------------------------------

/**
 * Checks in at a gym.
 *
 * Duration is clamped server-side to the 3-hour maximum, so the value passed
 * here is a request rather than a guarantee.
 */
export function useCheckIn() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      gymId,
      sessionId,
      durationMinutes,
    }: {
      gymId: string;
      sessionId?: string | null;
      durationMinutes?: number;
    }) => {
      const { data, error } = await supabase
        .rpc('check_in', {
          p_gym_id: gymId,
          p_session_id: sessionId ?? undefined,
          p_duration_minutes: durationMinutes ?? 120,
        })
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.presence() });
    },
  });
}

export function useCheckOut() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('check_out');
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.presence() });
    },
  });
}

/** The member's own current presence, or null when not checked in. */
export function useMyPresence() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.presence(),
    enabled: Boolean(user?.id),
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('presence')
        .select('*, gym:gyms ( id, name )')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
