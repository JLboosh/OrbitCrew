import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/auth/AuthProvider';
import { queryKeys } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Crew = Database['public']['Tables']['crews']['Row'];
export type CrewMember = Database['public']['Tables']['crew_members']['Row'];
export type CrewInvite = Database['public']['Tables']['crew_invites']['Row'];
export type Friendship = Database['public']['Tables']['friendships']['Row'];
export type CrewRole = Database['public']['Enums']['crew_role'];

/**
 * Canonical friendship pair ordering.
 *
 * The table stores one row per pair with `user_a < user_b` enforced by a CHECK
 * constraint, which is what makes a duplicate or contradictory reciprocal row
 * impossible. Clients must apply the same ordering when inserting.
 */
function orderedPair(one: string, two: string): { user_a: string; user_b: string } {
  return one < two ? { user_a: one, user_b: two } : { user_a: two, user_b: one };
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export interface FriendSummary {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Accepted friends. */
export function useFriends() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.friends(),
    enabled: Boolean(user?.id),
    queryFn: async (): Promise<FriendSummary[]> => {
      const { data, error } = await supabase
        .from('friendships')
        .select(
          `user_a, user_b, status,
           a:profiles!friendships_user_a_fkey ( id, username, display_name, avatar_url ),
           b:profiles!friendships_user_b_fkey ( id, username, display_name, avatar_url )`,
        )
        .eq('status', 'accepted');
      if (error) throw error;

      // Pick whichever side of the pair is not the caller.
      return (data ?? [])
        .map((row) => {
          const other = row.user_a === user!.id ? row.b : row.a;
          if (!other) return null;
          return {
            userId: other.id,
            username: other.username,
            displayName: other.display_name,
            avatarUrl: other.avatar_url,
          };
        })
        .filter((f): f is FriendSummary => f !== null);
    },
  });
}

/** Incoming and outgoing pending friend requests. */
export function useFriendRequests() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.friendRequests(),
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('friendships')
        .select(
          `user_a, user_b, requested_by, created_at,
           a:profiles!friendships_user_a_fkey ( id, username, display_name, avatar_url ),
           b:profiles!friendships_user_b_fkey ( id, username, display_name, avatar_url )`,
        )
        .eq('status', 'pending');
      if (error) throw error;

      const incoming: FriendSummary[] = [];
      const outgoing: FriendSummary[] = [];

      for (const row of data ?? []) {
        const other = row.user_a === user!.id ? row.b : row.a;
        if (!other) continue;
        const summary: FriendSummary = {
          userId: other.id,
          username: other.username,
          displayName: other.display_name,
          avatarUrl: other.avatar_url,
        };
        // Only the recipient may accept, so direction determines the UI.
        if (row.requested_by === user!.id) outgoing.push(summary);
        else incoming.push(summary);
      }

      return { incoming, outgoing };
    },
  });
}

/**
 * Finds a member by exact username.
 *
 * Uses the `find_profile_by_username` RPC, which honours the target's
 * `discoverable_by_username` setting and excludes blocked members. Deliberately
 * exact-match: a prefix search would let a client enumerate the user base.
 */
export function useFindProfileByUsername(username: string, enabled = true) {
  const handle = normaliseUsernameQuery(username);

  return useQuery({
    queryKey: ['profile-search', handle],
    /**
     * Any non-empty handle is searched.
     *
     * This used to require three characters, mirroring the `profiles_username_format`
     * minimum — the reasoning being that a shorter query could not possibly match.
     * True, but it made the UI refuse to search and tell the member their input was
     * too short, which reads as "you are holding it wrong" to someone who believes
     * their friend's handle really is that short. Running the query and honestly
     * reporting no match is clearer, and costs one indexed equality lookup.
     */
    enabled: enabled && handle.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('find_profile_by_username', {
        p_username: handle,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/**
 * Tidies a typed or pasted handle.
 *
 * People write and share handles as "@sam", so a leading @ is stripped rather than
 * sent to a lookup that would never match it. Case and surrounding whitespace are
 * already handled by the function itself (`lower(trim(...))`), but trimming here
 * keeps the query key stable so "sam" and "sam " are one cache entry.
 */
export function normaliseUsernameQuery(value: string): string {
  return value.trim().replace(/^@+/, '').trim();
}

export function useSendFriendRequest() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase.from('friendships').insert({
        ...orderedPair(user!.id, targetUserId),
        requested_by: user!.id,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.friendRequests() });
    },
  });
}

/** Accepts an incoming request. RLS permits this only for the recipient. */
export function useAcceptFriendRequest() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (requesterUserId: string) => {
      const pair = orderedPair(user!.id, requesterUserId);
      const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('user_a', pair.user_a)
        .eq('user_b', pair.user_b);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.friends() });
      client.invalidateQueries({ queryKey: queryKeys.friendRequests() });
    },
  });
}

/** Declines a request or removes an existing friend — both are a row delete. */
export function useRemoveFriendship() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const pair = orderedPair(user!.id, otherUserId);
      const { error } = await supabase
        .from('friendships')
        .delete()
        .eq('user_a', pair.user_a)
        .eq('user_b', pair.user_b);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.friends() });
      client.invalidateQueries({ queryKey: queryKeys.friendRequests() });
    },
  });
}

export function useBlockUser() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: user!.id, blocked_id: targetUserId });
      if (error) throw error;

      // A block should also end any friendship; leaving one would keep profile
      // visibility open through the friends policy.
      const pair = orderedPair(user!.id, targetUserId);
      await supabase
        .from('friendships')
        .delete()
        .eq('user_a', pair.user_a)
        .eq('user_b', pair.user_b);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.friends() });
      client.invalidateQueries({ queryKey: queryKeys.blocks() });
    },
  });
}

export function useBlockedUsers() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.blocks(),
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase.from('user_blocks').select('blocked_id, created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useUnblockUser() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', user!.id)
        .eq('blocked_id', targetUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.blocks() });
    },
  });
}

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------

/**
 * Crews the member belongs to, one row per crew.
 *
 * The `user_id` filter is essential and not redundant with RLS. The
 * `crew_members` SELECT policy permits reading EVERY member of a crew you belong
 * to — which is what the member list needs — so without this filter the query
 * returns one row per co-member. That produced duplicate React keys and, worse,
 * `role` could be another member's role, showing admin controls to a plain
 * member.
 *
 * Lesson: RLS defines what you MAY read, not what you MEANT to read.
 */
export function useMyCrews() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.crews(),
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_members')
        .select('role, joined_at, share_presence, activity_detail_override, crew:crews ( * )')
        .eq('user_id', user!.id)
        .order('joined_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCrew(crewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crew(crewId ?? 'none'),
    enabled: Boolean(crewId),
    queryFn: async (): Promise<Crew> => {
      const { data, error } = await supabase.from('crews').select('*').eq('id', crewId!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useCrewMembers(crewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crewMembers(crewId ?? 'none'),
    enabled: Boolean(crewId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_members')
        .select(
          'user_id, role, joined_at, profile:profiles ( id, username, display_name, avatar_url )',
        )
        .eq('crew_id', crewId!)
        .order('joined_at');
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Creates a crew via the `create_crew` RPC.
 *
 * A plain INSERT cannot work here: `crews_select_member` requires membership to
 * see a crew, owner membership is added by an AFTER INSERT trigger, and
 * PostgreSQL evaluates the RETURNING clause's SELECT policy BEFORE AFTER
 * triggers fire. The row would be written but the read-back would fail with a
 * confusing RLS error. The RPC does both atomically.
 */
export function useCreateCrew() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      timezone?: string;
      weeklyTargetSessions?: number;
      minSessionMinutes?: number;
      description?: string;
    }): Promise<Crew> => {
      const { data, error } = await supabase
        .rpc('create_crew', {
          p_name: input.name,
          p_timezone: input.timezone ?? deviceTimezone(),
          p_weekly_target_sessions: input.weeklyTargetSessions ?? 12,
          p_min_session_minutes: input.minSessionMinutes ?? 20,
          p_description: input.description ?? undefined,
        })
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.crews() });
    },
  });
}

/** Admin-only: crew settings including the weekly goal. */
export function useUpdateCrew() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      crewId,
      patch,
    }: {
      crewId: string;
      patch: Pick<
        Database['public']['Tables']['crews']['Update'],
        | 'name'
        | 'description'
        | 'timezone'
        | 'weekly_target_sessions'
        | 'min_session_minutes'
        | 'leaderboard_metric'
        | 'spotlight_enabled'
      >;
    }) => {
      const { data, error } = await supabase
        .from('crews')
        .update(patch)
        .eq('id', crewId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { crewId }) => {
      client.invalidateQueries({ queryKey: queryKeys.crew(crewId) });
      client.invalidateQueries({ queryKey: queryKeys.crews() });
    },
  });
}

/** Admin-only. Codes always carry an expiry. */
export function useCreateCrewInvite() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      crewId,
      expiresInHours,
      maxUses,
    }: {
      crewId: string;
      expiresInHours?: number;
      maxUses?: number | null;
    }): Promise<CrewInvite> => {
      const { data, error } = await supabase
        .rpc('create_crew_invite', {
          p_crew_id: crewId,
          p_expires_in_hours: expiresInHours ?? 168,
          p_max_uses: maxUses ?? undefined,
        })
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { crewId }) => {
      client.invalidateQueries({ queryKey: queryKeys.crewInvites(crewId) });
    },
  });
}

export function useCrewInvites(crewId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.crewInvites(crewId ?? 'none'),
    enabled: Boolean(crewId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crew_invites')
        .select('*')
        .eq('crew_id', crewId!)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/** The only path into a crew. */
export function useRedeemCrewInvite() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await supabase.rpc('redeem_crew_invite', {
        p_code: code.trim().toUpperCase(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.crews() });
    },
  });
}

/** Revoking preserves the audit trail, so it is an update rather than a delete. */
export function useRevokeCrewInvite() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ inviteId, crewId }: { inviteId: string; crewId: string }) => {
      const { error } = await supabase
        .from('crew_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', inviteId);
      if (error) throw error;
      return crewId;
    },
    onSuccess: (crewId) => {
      client.invalidateQueries({ queryKey: queryKeys.crewInvites(crewId) });
    },
  });
}

/**
 * Per-crew privacy preferences for the signed-in member.
 *
 * A detail override more revealing than the member's global default is clamped
 * down by a database trigger, so joining a crew can never widen what they share.
 */
export function useUpdateCrewMembership() {
  const { user } = useAuth();
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      crewId,
      sharePresence,
      activityDetailOverride,
    }: {
      crewId: string;
      sharePresence?: boolean;
      activityDetailOverride?: Database['public']['Enums']['activity_detail_level'] | null;
    }) => {
      const patch: Database['public']['Tables']['crew_members']['Update'] = {};
      if (sharePresence !== undefined) patch.share_presence = sharePresence;
      if (activityDetailOverride !== undefined) {
        patch.activity_detail_override = activityDetailOverride;
      }

      const { error } = await supabase
        .from('crew_members')
        .update(patch)
        .eq('crew_id', crewId)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: (_d, { crewId }) => {
      client.invalidateQueries({ queryKey: queryKeys.crews() });
      client.invalidateQueries({ queryKey: queryKeys.crewMembers(crewId) });
    },
  });
}

/** Leaving a crew, or an admin removing a member. The owner cannot be removed. */
export function useRemoveCrewMember() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({ crewId, userId }: { crewId: string; userId: string }) => {
      const { error } = await supabase
        .from('crew_members')
        .delete()
        .eq('crew_id', crewId)
        .eq('user_id', userId);
      if (error) throw error;
      return crewId;
    },
    onSuccess: (crewId) => {
      client.invalidateQueries({ queryKey: queryKeys.crews() });
      client.invalidateQueries({ queryKey: queryKeys.crewMembers(crewId) });
    },
  });
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
