import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';

export interface LeaderboardRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  sessions_completed: number;
  is_caller: boolean;
  week_start: string;
}

/**
 * The crew's weekly leaderboard.
 *
 * Ranked by sessions completed, resetting Monday 00:00 in the CREW's timezone so
 * members in different countries are measured over the same window.
 *
 * Note what this intentionally does NOT return: total weight lifted or session
 * duration. Ranking on those would favour heavier lifters and members with more
 * free time, which makes a board discouraging rather than motivating. If a
 * future metric is added, it must be fair across schedules and experience.
 *
 * @param weekOffset 0 = this week, -1 = last week.
 */
export function useCrewLeaderboard(crewId: string | undefined, weekOffset = 0) {
  return useQuery({
    queryKey: queryKeys.crewLeaderboard(crewId ?? 'none', weekOffset),
    enabled: Boolean(crewId),
    queryFn: async (): Promise<LeaderboardRow[]> => {
      const { data, error } = await supabase.rpc('crew_weekly_leaderboard', {
        p_crew_id: crewId!,
        p_week_offset: weekOffset,
      });
      if (error) throw error;
      return (data ?? []) as LeaderboardRow[];
    },
  });
}

export interface CrewProgress {
  week_start: string;
  sessions_completed: number;
  weekly_target: number;
  percent_complete: number;
}

/** Crew progress toward its combined weekly session target. */
export function useCrewProgress(crewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crewProgress(crewId ?? 'none'),
    enabled: Boolean(crewId),
    queryFn: async (): Promise<CrewProgress | null> => {
      const { data, error } = await supabase
        .rpc('crew_weekly_progress', { p_crew_id: crewId! })
        .maybeSingle();
      if (error) throw error;
      return (data as CrewProgress | null) ?? null;
    },
  });
}

/**
 * Members of the crew who have earned badges.
 *
 * Read-only here: badges are awarded by the scoring engine, and the challenge
 * lifecycle itself is owned by the challenges lane.
 */
export function useCrewBadges(userIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['crew-badges', ...userIds.slice().sort()],
    enabled: Boolean(user?.id) && userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_badges')
        .select('user_id, badge_key, awarded_at, badge:badges ( key, name, emoji )')
        .in('user_id', userIds)
        .order('awarded_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}
