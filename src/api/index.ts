/**
 * Typed data-access layer.
 *
 * Every database read and write goes through these hooks. Screens should not
 * call `supabase` directly — centralising it here means query keys, cache
 * invalidation, and error handling stay consistent, and a schema change surfaces
 * as a type error in one place rather than in a dozen components.
 *
 * ---------------------------------------------------------------------------
 * LANE OWNERSHIP
 * ---------------------------------------------------------------------------
 * Modules present here cover the foundation, sessions/logging, social, and
 * ratings/leaderboard features.
 *
 * The following are NOT implemented here and belong to the gyms/map, stats, and
 * challenges lane. The database side is complete and verified, so building them
 * is a matter of wrapping existing RPCs:
 *
 *   Nearby gyms / map    -> rpc('nearby_gyms', { p_latitude, p_longitude,
 *                                                p_radius_metres, p_limit })
 *                        -> rpc('gym_presence', { p_gym_id })
 *                        -> rpc('gym_friend_visits', { p_gym_id })
 *   Stats / progress     -> rpc('exercise_progress')
 *                        -> rpc('weekly_training_summary', { p_weeks })
 *                        -> rpc('training_streak')
 *                        -> table('personal_records')
 *   Challenges           -> table('challenge_templates'), table('challenges'),
 *                           table('challenge_participants')
 *                        -> rpc('rescore_challenge', { p_challenge_id })
 *
 * Add them as `src/api/gyms.ts`, `src/api/progress.ts`, and
 * `src/api/challenges.ts`, following the same patterns used here.
 */

// Identity and privacy
export {
  useMyPrivacySettings,
  useMyProfile,
  useUpdatePrivacySettings,
  useUpdateProfile,
  type ActivityDetailLevel,
  type PresenceVisibility,
  type PrivacyPatch,
  type PrivacySettings,
  type Profile,
} from './profile';

// Sessions, logging, presence
export {
  useActiveSession,
  useAddSessionExercise,
  useCheckIn,
  useCheckOut,
  useCreateCustomExercise,
  useDeleteSet,
  useEndSession,
  useExercises,
  useLogSet,
  useMyPresence,
  useRecentSessions,
  useRemoveSessionExercise,
  useStartSession,
  useUpdateSessionNotes,
  type Exercise,
  type LogSetInput,
  type Session,
  type SessionDetail,
  type SetRow,
  type WeightUnit,
} from './sessions';

// Friends and crews
export {
  useAcceptFriendRequest,
  useBlockedUsers,
  useBlockUser,
  useCreateCrew,
  useCreateCrewInvite,
  useCrew,
  useCrewInvites,
  useCrewMembers,
  useFindProfileByUsername,
  useFriendRequests,
  useFriends,
  useMyCrews,
  useRedeemCrewInvite,
  useRemoveCrewMember,
  useRemoveFriendship,
  useRevokeCrewInvite,
  useSendFriendRequest,
  useUnblockUser,
  useUpdateCrew,
  useUpdateCrewMembership,
  type Crew,
  type CrewInvite,
  type CrewMember,
  type CrewRole,
  type FriendSummary,
} from './social';

// Gym ratings
export {
  RATING_AXES,
  useGym,
  useGymRatings,
  useGymRatingSummary,
  useMyGymRating,
  useReportGym,
  useSubmitGymRating,
  useUpdateGymRating,
  type Gym,
  type GymRating,
  type GymRatingPatch,
  type RatingAxis,
  type RatingInput,
} from './ratings';

// Leaderboard
export {
  useCrewBadges,
  useCrewLeaderboard,
  useCrewProgress,
  type CrewProgress,
  type LeaderboardRow,
} from './leaderboard';
