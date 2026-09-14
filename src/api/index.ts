/**
 * Typed data-access layer.
 *
 * Every database read and write goes through these hooks. Screens should not
 * call `supabase` directly — centralising it here means query keys, cache
 * invalidation, and error handling stay consistent, and a schema change surfaces
 * as a type error in one place rather than in a dozen components.
 *
 * ---------------------------------------------------------------------------
 * COVERAGE
 * ---------------------------------------------------------------------------
 * All seven product areas now have a data-access module:
 *
 *   profile.ts     Identity and privacy
 *   sessions.ts    Sessions, logging, check-in/out
 *   social.ts      Friends, crews, invites
 *   ratings.ts     Gym lookup and seven-axis ratings
 *   leaderboard.ts Weekly leaderboard and crew progress
 *   gyms.ts        Nearby search, live presence, friend visits
 *   progress.ts    PRs, estimated 1RM, volume, consistency, streaks
 *   challenges.ts  Templates, instances, participation, scoring, badges
 *
 * One database capability is still missing rather than merely unwrapped:
 * community crowd patterns ("usually busy Tue 5-7 PM"). It needs a new
 * security-definer function aggregating check-ins from members who set
 * `privacy_settings.contribute_to_crowd_stats`, because `sessions` is
 * own-rows-only under RLS. `useMyGymVisitPattern` shows the member their OWN
 * pattern in the meantime and must not be presented as a crowd forecast.
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

// Gyms, nearby search, live presence
export {
  useGymFriendVisits,
  useGymPresence,
  useGymSearch,
  useMyGymVisitPattern,
  useNearbyGyms,
  type GymFriendVisits,
  type GymPresenceMember,
  type GymRow,
  type MyGymVisitPattern,
  type NamedVisitor,
  type NearbyGym,
} from './gyms';

// Stats and progress
export {
  averageSessionDuration,
  averageSessionsPerWeek,
  compareTrainingBlocks,
  toWeekBuckets,
  useExerciseProgress,
  usePersonalRecords,
  useTrainingStreak,
  useWeeklyTrainingSummary,
  type ExerciseProgressRow,
  type PersonalRecordRow,
  type PersonalRecordWithExercise,
  type RecordType,
  type TrainingBlockComparison,
  type TrainingStreak,
  type WeekBucket,
  type WeeklySummaryRow,
} from './progress';

// Challenges
export {
  combinedProgress,
  useChallenge,
  useChallengeParticipants,
  useChallengeTemplates,
  useCreateChallenge,
  useCrewChallenges,
  useDeleteChallenge,
  useJoinChallenge,
  useLeaveChallenge,
  useMyBadges,
  useMyChallenges,
  useRescoreChallenge,
  useVisibleCrewChallenges,
  type Challenge,
  type ChallengeParticipant,
  type ChallengeParticipantRow,
  type ChallengeScope,
  type ChallengeTemplate,
  type ChallengeVisibility,
  type ChallengeWithTemplate,
  type CreateChallengeInput,
  type EarnedBadge,
  type MyChallenge,
} from './challenges';
