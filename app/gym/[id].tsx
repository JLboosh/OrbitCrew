import { useLocalSearchParams } from 'expo-router';

import { useGym, useGymRatingSummary } from '@/api';
import { Card, Screen, Text } from '@/components/ui';

/**
 * ==========================================================================
 * PARTIAL — gym identity and ratings are wired; the rest is the gyms/map lane
 * ==========================================================================
 * The ratings workstream owns the rating summary shown here, so `useGym` and
 * `useGymRatingSummary` are already connected as a working reference.
 *
 * STILL TO BUILD (gyms/map lane)
 *   * Opening hours and distance from the member
 *   * Crowd-pattern chart ("usually busy Tue 5-7 PM")
 *   * Friend visit history      -> rpc('gym_friend_visits', { p_gym_id })
 *   * Live presence list        -> rpc('gym_presence', { p_gym_id })
 *   * Check-in button           -> useCheckIn() from src/api/sessions.ts
 *   * Rating submission form    -> useSubmitGymRating() and RATING_AXES
 *
 * RATING RULES ALREADY ENFORCED BY THE DATABASE
 *   * One NEW rating per member per gym per 30 days. The rejection message
 *     contains "30 days" and can be surfaced verbatim.
 *   * Revising an existing rating is always allowed.
 *   * All seven axes run 1-5, and `crowding` is oriented so HIGHER IS BETTER
 *     (5 = pleasantly quiet), matching every other axis. Do not invert it.
 *
 * CROWD PATTERNS: derive these from opted-in check-ins only
 * (privacy_settings.contribute_to_crowd_stats). Do not claim real-time
 * occupancy unless there are enough live check-ins for it to mean anything.
 */
export default function GymDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: gym, isLoading } = useGym(id);
  const { data: summary } = useGymRatingSummary(id);

  if (isLoading) {
    return (
      <Screen title="Gym">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  return (
    <Screen title={gym?.name ?? 'Gym'} subtitle={gym?.address ?? undefined}>
      <Card>
        <Text variant="subheading" heading>
          Ratings
        </Text>
        {summary && Number(summary.rating_count) > 0 ? (
          <>
            <Text variant="metric">{Number(summary.avg_overall).toFixed(1)}</Text>
            <Text variant="caption" tone="muted">
              {summary.rating_count} rating{Number(summary.rating_count) === 1 ? '' : 's'}
            </Text>
            <Text variant="caption" tone="muted">
              Air conditioning {fmt(summary.avg_air_conditioning)} · Equipment{' '}
              {fmt(summary.avg_equipment_quality)} · Availability{' '}
              {fmt(summary.avg_equipment_availability)} · Cleanliness {fmt(summary.avg_cleanliness)}{' '}
              · Space {fmt(summary.avg_crowding)} · Value {fmt(summary.avg_value_for_money)}
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="muted">
            No ratings yet.
          </Text>
        )}
      </Card>

      <Card>
        <Text variant="subheading">More coming</Text>
        <Text variant="caption" tone="muted">
          Hours, crowd patterns, friend visits, live presence, and check-in belong to the gyms and
          map workstream. See the comment at the top of this file for the functions already
          available.
        </Text>
      </Card>

      <Text variant="caption" tone="subtle">
        Gym data © OpenStreetMap contributors
      </Text>
    </Screen>
  );
}

function fmt(value: number | null): string {
  return value == null ? '—' : Number(value).toFixed(1);
}
