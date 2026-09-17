import { QueryClient } from '@tanstack/react-query';

/**
 * Shared React Query client.
 *
 * Defaults are tuned for a gym app used on a phone with unreliable signal:
 *
 *   * `staleTime` of 30s stops a tab switch mid-workout from refetching
 *     everything, which would waste data and flicker the UI.
 *   * Retries are limited and skip 4xx, because a 401 or a row-level-security
 *     denial will never succeed on retry — only network faults will.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (isClientError(error)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations are not retried by default: re-sending "log this set" or
      // "check in" could duplicate user-visible data.
      retry: false,
    },
  },
});

function isClientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: number }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * Query key factory.
 *
 * Centralised so cache invalidation cannot silently miss a key because two
 * modules spelled it differently.
 *
 * A NOTE ON OWNERSHIP. Most keys here say "mine" without saying whose —
 * `myChallenges()`, `activeSession()`, `presence()`, `personalRecords()`. That is
 * only safe because `AuthProvider` clears this client whenever the signed-in
 * member changes; without that, a second sign-in reads the first member's rows
 * from cache. See the comment on that effect before adding another key of this
 * shape, and do not remove the clear.
 */
export const queryKeys = {
  profile: (userId: string) => ['profile', userId] as const,
  privacySettings: (userId: string) => ['privacy-settings', userId] as const,

  friends: () => ['friends'] as const,
  friendRequests: () => ['friend-requests'] as const,
  blocks: () => ['blocks'] as const,

  crews: () => ['crews'] as const,
  crew: (crewId: string) => ['crew', crewId] as const,
  crewMembers: (crewId: string) => ['crew', crewId, 'members'] as const,
  crewInvites: (crewId: string) => ['crew', crewId, 'invites'] as const,
  crewLeaderboard: (crewId: string, weekOffset: number) =>
    ['crew', crewId, 'leaderboard', weekOffset] as const,
  crewProgress: (crewId: string) => ['crew', crewId, 'progress'] as const,

  activeSession: () => ['session', 'active'] as const,
  sessions: () => ['sessions'] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
  sessionExercises: (sessionId: string) => ['session', sessionId, 'exercises'] as const,

  exercises: () => ['exercises'] as const,

  gym: (gymId: string) => ['gym', gymId] as const,
  gymRatings: (gymId: string) => ['gym', gymId, 'ratings'] as const,
  gymRatingSummary: (gymId: string) => ['gym', gymId, 'rating-summary'] as const,

  presence: () => ['presence'] as const,
  /**
   * Which gyms in a set have anyone checked in. Keyed on the sorted, joined ids
   * so panning back to a previously seen set of pins is a cache hit.
   */
  gymsWithPresence: (gymIdKey: string) => ['presence', 'gyms', gymIdKey] as const,

  // Gyms and map. The nearby key includes the rounded origin and radius so
  // panning to a new area is a new cache entry rather than a silent overwrite.
  nearbyGyms: (latitude: number, longitude: number, radiusMetres: number) =>
    ['gyms', 'nearby', latitude.toFixed(3), longitude.toFixed(3), radiusMetres] as const,
  gymSearch: (query: string) => ['gyms', 'search', query] as const,
  /** Possible duplicates for a gym about to be submitted. */
  similarGyms: (name: string, latitude: number, longitude: number) =>
    ['gyms', 'similar', name, latitude.toFixed(4), longitude.toFixed(4)] as const,
  gymPresence: (gymId: string) => ['gym', gymId, 'presence'] as const,
  gymFriendVisits: (gymId: string) => ['gym', gymId, 'friend-visits'] as const,
  gymMyVisits: (gymId: string) => ['gym', gymId, 'my-visits'] as const,

  // Stats and progress.
  exerciseProgress: () => ['progress', 'exercises'] as const,
  weeklySummary: (weeks: number) => ['progress', 'weekly', weeks] as const,
  trainingStreak: () => ['progress', 'streak'] as const,
  personalRecords: () => ['progress', 'personal-records'] as const,

  // Challenges.
  challengeTemplates: () => ['challenges', 'templates'] as const,
  /**
   * Today's challenge, keyed by the member's LOCAL day.
   *
   * The day is part of the key so that crossing midnight produces a cache miss
   * and the next day's challenge is fetched, rather than yesterday's being served
   * from cache until `gcTime` expires.
   */
  dailyChallenge: (dayKey: string) => ['challenges', 'daily', dayKey] as const,
  myChallenges: () => ['challenges', 'mine'] as const,
  joinableChallenges: () => ['challenges', 'joinable'] as const,
  challenge: (challengeId: string) => ['challenges', challengeId] as const,
  challengeParticipants: (challengeId: string) =>
    ['challenges', challengeId, 'participants'] as const,
  crewChallenges: (crewId: string) => ['crew', crewId, 'challenges'] as const,
  myBadges: () => ['badges', 'mine'] as const,
} as const;
