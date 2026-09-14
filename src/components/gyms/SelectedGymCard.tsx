import { View } from 'react-native';

import {
  useCheckIn,
  useGymFriendVisits,
  useGymPresence,
  useGymRatingSummary,
  useMyPresence,
  type NearbyGym,
} from '@/api';
import { Button, Card, Text } from '@/components/ui';
import { formatDistance, type DistanceSystem } from '@/lib/geo';
import { readOpeningHours } from '@/lib/openingHours';
import { useTheme } from '@/theme';

export interface SelectedGymCardProps {
  gym: NearbyGym;
  distanceSystem?: DistanceSystem;
  onOpenDetail: (gymId: string) => void;
}

/**
 * The detail panel for a gym selected on the map.
 *
 * Fetched per selection rather than per list row: rating averages, friend visits,
 * and live presence are three queries, and running them for 50 rows at once would
 * be wasteful and slow.
 *
 * PRIVACY NOTES THAT SHAPE THIS UI
 *   * The presence list arrives pre-filtered to members who opted in AND whom the
 *     caller may see. Nothing further is decided here.
 *   * `visitorCount` counts everyone; `namedVisitors` holds only those who share
 *     gym-level detail. They are shown as separate facts, never merged into
 *     "4: Alex, Sam", which would imply the other two were also named.
 */
export function SelectedGymCard({
  gym,
  distanceSystem = 'metric',
  onOpenDetail,
}: SelectedGymCardProps) {
  const theme = useTheme();

  const { data: summary } = useGymRatingSummary(gym.id);
  const { data: visits } = useGymFriendVisits(gym.id);
  const { data: presence } = useGymPresence(gym.id);
  const { data: myPresence } = useMyPresence();
  const checkIn = useCheckIn();

  const hours = readOpeningHours(gym.opening_hours);
  const ratingCount = Number(summary?.rating_count ?? 0);
  const checkedInHere = myPresence?.gym_id === gym.id;

  // Derived before the JSX so the open/closed/unknown decision is stated once.
  // `null` means the OSM expression was not understood, and must not read as
  // "closed" — the raw value is shown instead.
  const openTone = hours?.isOpenNow === true ? 'success' : 'muted';
  const openLabel =
    hours?.isOpenNow === true ? 'Open now' : hours?.isOpenNow === false ? 'Closed now' : 'Hours';

  return (
    <Card>
      <Text variant="subheading" heading>
        {gym.name}
      </Text>

      <Text variant="caption" tone="muted">
        {formatDistance(gym.distance_metres, distanceSystem)} away
        {gym.address ? ` · ${gym.address}` : ''}
      </Text>

      {hours ? (
        <Text variant="caption" tone={openTone}>
          {openLabel}
          {hours.todayLabel ? ` · ${hours.todayLabel}` : ` · ${hours.raw}`}
        </Text>
      ) : null}

      {ratingCount > 0 ? (
        <Text variant="caption" tone="muted">
          {Number(summary?.avg_overall ?? 0).toFixed(1)} overall from {ratingCount}{' '}
          {ratingCount === 1 ? 'rating' : 'ratings'}
        </Text>
      ) : (
        <Text variant="caption" tone="subtle">
          No ratings yet.
        </Text>
      )}

      {/* Friend history: an aggregate count, plus names only where permitted. */}
      {visits && visits.visitorCount > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="caption" tone="muted">
            {visits.visitorCount} {visits.visitorCount === 1 ? 'person' : 'people'} you know{' '}
            {visits.visitorCount === 1 ? 'has' : 'have'} trained here.
          </Text>
          {visits.namedVisitors.length > 0 ? (
            <Text variant="caption" tone="subtle">
              {joinNames(visits.namedVisitors.map((visitor) => visitor.displayName))}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Live presence. Off by default for everyone, so an empty list is normal. */}
      {presence && presence.length > 0 ? (
        <Text variant="caption" tone="accent">
          {joinNames(presence.map((member) => member.display_name))}{' '}
          {presence.length === 1 ? 'is' : 'are'} checked in right now.
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <Button label="Open gym page" variant="secondary" onPress={() => onOpenDetail(gym.id)} />
        {checkedInHere ? (
          <Button label="Checked in" variant="ghost" disabled />
        ) : (
          <Button
            label="Check in"
            loading={checkIn.isPending}
            onPress={() => checkIn.mutate({ gymId: gym.id })}
          />
        )}
      </View>

      {checkIn.isError ? (
        <Text variant="caption" tone="danger">
          Could not check in. Please try again.
        </Text>
      ) : null}

      {!checkedInHere ? (
        <Text variant="caption" tone="subtle">
          Checking in shares the gym name with the people you chose in Privacy, and ends
          automatically within three hours.
        </Text>
      ) : null}
    </Card>
  );
}

/** "Alex", "Alex and Sam", "Alex, Sam and Jo". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';

  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1] ?? '';
  return `${head} and ${tail}`;
}
