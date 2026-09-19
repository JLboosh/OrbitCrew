import type { Database as Generated, Json } from './database.types';

/**
 * The database type the app uses.
 *
 * Everything in the app imports `Database` from HERE rather than from
 * `database.types`, so there is one place to look when the generated types and
 * reality disagree.
 *
 * HISTORY WORTH KNOWING
 * ---------------------
 * This file used to merge the whole of
 * `20260917000001_user_gyms_workout_types_daily_challenges.sql` onto the
 * generated type, because that migration had not been applied to the database the
 * types were generated from. It has now been applied and `npm run db:types` has
 * been re-run, so `gyms.description`/`image_url`/`created_by`,
 * `sessions.workout_categories`, `exercises.description`, and the three new
 * functions all come from the generated file directly. The overlay is gone.
 *
 * If the app ever reports "Could not find the ... in the schema cache" again,
 * that is the same class of bug: the client is ahead of the database. Apply the
 * pending migration and regenerate — do not re-add an overlay to silence the
 * type error, because the runtime failure is real.
 */
export type Database = Generated;

export type { Json };

/**
 * A candidate returned by `find_similar_gyms`.
 *
 * Declared by hand rather than taken from the generated function type because
 * `supabase gen types` loses nullability on set-returning functions: it claims
 * `address: string` when the column is nullable and the function selects it
 * straight from `gyms`. Same reason `NearbyGym` in `src/api/gyms.ts` and
 * `LeaderboardRow` in `src/api/leaderboard.ts` are declared locally.
 */
export interface SimilarGymRow {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_metres: number;
  /** One of `same_name`, `same_address`, `similar_name`, `very_close`. */
  match_reason: string;
  /**
   * True when the server considers this near-certainly the same gym and will
   * refuse the submission until the member confirms.
   */
  is_probable_duplicate: boolean;
}
