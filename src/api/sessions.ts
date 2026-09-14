import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

export type Session = Database['public']['Tables']['sessions']['Row'];
export type Exercise = Database['public']['Tables']['exercises']['Row'];
export type SessionExercise = Database['public']['Tables']['session_exercises']['Row'];
export type SetRow = Database['public']['Tables']['sets']['Row'];
export type WeightUnit = Database['public']['Enums']['weight_unit'];

/** A session with its exercises and sets, shaped for the Active Session screen. */
export interface SessionDetail extends Session {
  session_exercises: (SessionExercise & {
    exercise: Pick<Exercise, 'id' | 'name' | 'primary_muscle' | 'equipment' | 'is_weighted'>;
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

/** Starts a session, optionally at a gym. */
export function useStartSession() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { gymId?: string | null } = {}) => {
      const { data, error } = await supabase
        .from('sessions')
        .insert({ user_id: user!.id, gym_id: input.gymId ?? null })
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
    mutationFn: async (sessionId?: string) => {
      const { data, error } = await supabase
        .rpc('end_session', { p_session_id: sessionId ?? undefined })
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.activeSession() });
      client.invalidateQueries({ queryKey: queryKeys.sessions() });
      // Ending a session clears presence via trigger, and changes leaderboards.
      client.invalidateQueries({ queryKey: queryKeys.presence() });
      client.invalidateQueries({ queryKey: queryKeys.crews() });
    },
  });
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

/** The exercise library: canonical entries plus the member's own custom ones. */
export function useExercises() {
  return useQuery({
    queryKey: queryKeys.exercises(),
    // Rarely changes, so cache it for the session rather than refetching.
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Exercise[]> => {
      const { data, error } = await supabase.from('exercises').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCustomExercise() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      primaryMuscle: Database['public']['Enums']['muscle_group'];
      equipment?: Database['public']['Enums']['exercise_equipment'];
      isWeighted?: boolean;
    }) => {
      const { data, error } = await supabase
        .from('exercises')
        .insert({
          name: input.name.trim(),
          primary_muscle: input.primaryMuscle,
          equipment: input.equipment ?? 'other',
          is_weighted: input.isWeighted ?? true,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
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
