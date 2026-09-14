import { Card, Screen, Text } from '@/components/ui';

/**
 * ==========================================================================
 * PLACEHOLDER — OWNED BY THE STATS/PROGRESS LANE
 * ==========================================================================
 * Not implemented by the foundation work. All the calculations already exist in
 * the database and are verified against the real project, so this screen is
 * presentation only — do NOT recompute any of this in JavaScript.
 *
 * WHY THE MATHS LIVES IN THE DATABASE
 * `sets.estimated_1rm_kg` is a GENERATED column using Epley
 * (weight x (1 + reps/30)), and `sets.weight_kg` is a generated exact
 * pound-to-kilogram conversion. Keeping them there means the app, the challenge
 * engine, and the leaderboard can never disagree about a member's numbers.
 *
 * READY-MADE DATABASE CONTRACT
 *   supabase.rpc('exercise_progress')
 *     -> { exercise_id, exercise_name, baseline_1rm_kg, current_1rm_kg,
 *          improvement_percent, achieved_at }
 *
 *   supabase.rpc('weekly_training_summary', { p_weeks })
 *     -> { week_start, session_count, total_volume_kg,
 *          total_duration_seconds, avg_duration_seconds }
 *     Weeks are Monday-anchored in the MEMBER'S timezone, so a Sunday-night
 *     session lands in the week it felt like.
 *
 *   supabase.rpc('training_streak')
 *     -> { current_streak_weeks, longest_streak_weeks, last_session_at }
 *     Streaks count WEEKS, not days: a rest day is part of training and must
 *     never break a streak.
 *
 *   supabase.from('personal_records')
 *     -> record_type is one of max_weight | estimated_1rm | max_reps |
 *        max_session_volume. Values are kilograms (or a rep count).
 *        Trigger-maintained, and members cannot write to this table.
 *
 * PRODUCT RULES FOR THIS SCREEN
 *   * NEVER show a bare aggregate like "you improved 200%". Every percentage
 *     must be shown with the measurement behind it, e.g.
 *     "Bench estimated 1RM: 135 lb -> 185 lb (+37%)".
 *     `exercise_progress` returns both endpoints precisely so you can do this.
 *   * Convert kilograms to the member's preferred unit for DISPLAY only, using
 *     profiles.weight_unit. Never write converted values back.
 *   * Falling behind is not a failure state. There is no red in the palette for
 *     "bad" progress — see the comment in src/theme/colors.ts.
 *   * Friends may only see progress when share_progress_summary is true.
 *
 * Add hooks as src/api/progress.ts, following the patterns in src/api/sessions.ts.
 */
export default function ProgressScreen() {
  return (
    <Screen title="Progress" subtitle="See how you are improving.">
      <Card>
        <Text variant="subheading">Not built yet</Text>
        <Text variant="caption" tone="muted">
          This screen belongs to the stats workstream. Personal records, estimated one-rep max,
          volume, weekly consistency, and streaks are all computed and verified in the database
          already.
        </Text>
      </Card>
      <Card>
        <Text variant="caption" tone="subtle">
          See the comment block at the top of app/(tabs)/progress.tsx for the available functions
          and the rule that every percentage must be shown with the measurement behind it.
        </Text>
      </Card>
    </Screen>
  );
}
