import { View } from 'react-native';

import {
  useCheckIn,
  useGymFriendVisits,
  useGymPresence,
  useGymRatingSummary,
  useMyPresence,
  type GymPresenceMember,
  type NearbyGym,
} from '@/api';
import { Avatar, Badge, Button, Card, Text } from '@/components/ui';
import { formatDistance, type DistanceSystem } from '@/lib/geo';
import { readOpeningHours } from '@/lib/openingHours';
import { formatDurationSeconds } from '@/lib/units';
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
 *   * Presence is gym-level. There is no coordinate for a person anywhere in this
 *     card, or in the schema behind it.
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

  const here = presence ?? [];

  // Derived before the JSX so the open/closed/unknown decision is stated once.
  // `null` means the OSM expression was not understood, and must not read as
  // "closed" — the raw value is shown instead.
  const openTone = hours?.isOpenNow === true ? 'success' : 'muted';
  const openLabel =
    hours?.isOpenNow === true ? 'Open now' : hours?.isOpenNow === false ? 'Closed now' : 'Hours';

  const crowd = describeCrowd(summary?.avg_crowding, ratingCount);

  return (
    <Card>
      <View style={styles.titleRow(theme.spacing.sm)}>
        <Text variant="subheading" heading style={{ flex: 1 }}>
          {gym.name}
        </Text>
        {/* "Live" only when somebody is actually here. */}
        {here.length > 0 ? <Badge label={`${here.length} here now`} tone="accent" live /> : null}
      </View>

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

      {/* -------------------------------------------------------------------
          Rating and crowd.
          Kept on one line as two separate facts. `crowding` is a RATING axis
          oriented so higher is quieter — it is not a live headcount, and the
          wording must never let it be read as one.
          ------------------------------------------------------------------- */}
      <View style={styles.factRow(theme.spacing.sm)}>
        {ratingCount > 0 ? (
          <Text variant="caption" tone="muted">
            ★ {Number(summary?.avg_overall ?? 0).toFixed(1)} from {ratingCount}{' '}
            {ratingCount === 1 ? 'rating' : 'ratings'}
          </Text>
        ) : (
          <Text variant="caption" tone="subtle">
            No ratings yet
          </Text>
        )}

        {crowd ? (
          <Text variant="caption" tone="muted">
            · {crowd}
          </Text>
        ) : null}
      </View>

      {/* -------------------------------------------------------------------
          Live presence: who is here, with avatars and how long they have been
          checked in. Off by default for everyone, so an empty list is normal
          rather than a failure.
          ------------------------------------------------------------------- */}
      {here.length > 0 ? (
        <View style={{ gap: theme.spacing.xs }}>
          {here.map((member) => (
            <PresenceRow key={member.user_id} member={member} />
          ))}
        </View>
      ) : null}

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

/**
 * One member checked in right now: avatar, name, and how long they have been here.
 *
 * The duration comes from `since`, the check-in timestamp — the only time value
 * the presence row exposes. It is therefore "how long they have been checked in",
 * which is what is actually known, and is omitted entirely rather than guessed
 * when the timestamp is unusable. A member who checked in without starting a
 * session simply shows no duration.
 */
function PresenceRow({ member }: { member: GymPresenceMember }) {
  const theme = useTheme();
  const duration = checkedInFor(member.since);

  return (
    <View style={styles.presenceRow(theme.spacing.sm)}>
      <Avatar id={member.user_id} name={member.display_name} size={26} />
      <Text variant="caption" tone="accent" style={{ flex: 1 }} numberOfLines={1}>
        {member.display_name}
        {duration ? ` · here ${duration}` : ' · checked in'}
      </Text>
    </View>
  );
}

/**
 * Elapsed time since check-in, or null when the timestamp makes no sense.
 *
 * Guards against a clock skew producing "here -3 min", which would look like a
 * bug in the app rather than a difference between two clocks.
 */
export function checkedInFor(since: string, now: Date = new Date()): string | null {
  const started = Date.parse(since);
  if (!Number.isFinite(started)) return null;

  const seconds = (now.getTime() - started) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 0) return null;

  return formatDurationSeconds(seconds);
}

/**
 * The `crowding` rating axis, in words.
 *
 * IMPORTANT: this is a RATING, not a live occupancy measure, and the label says
 * so. The axis is oriented so 5 means pleasantly quiet — inverting it here would
 * put this card at odds with the rating form, the gym page, and the database.
 *
 * A genuine live crowd signal would need aggregated check-in volume from members
 * who set `privacy_settings.contribute_to_crowd_stats`, which does not exist yet.
 * Until it does, the honest thing is to label what we have as what it is.
 */
export function describeCrowd(
  avgCrowding: number | null | undefined,
  ratingCount: number,
): string | null {
  if (ratingCount <= 0 || avgCrowding == null || !Number.isFinite(Number(avgCrowding))) return null;

  const score = Number(avgCrowding);
  const word =
    score >= 4.2
      ? 'rarely busy'
      : score >= 3.4
        ? 'usually room to train'
        : score >= 2.6
          ? 'can get busy'
          : 'often crowded';

  return `${word} (space rated ${score.toFixed(1)}/5)`;
}

/** "Alex", "Alex and Sam", "Alex, Sam and Jo". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';

  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1] ?? '';
  return `${head} and ${tail}`;
}

/**
 * Layout only, as functions of the spacing token.
 *
 * `StyleSheet.create` cannot read the theme, and these three rows all need a
 * themed gap, so they are plain objects built from the token rather than
 * hardcoded numbers.
 */
const styles = {
  titleRow: (gap: number) => ({ flexDirection: 'row', alignItems: 'center', gap }) as const,
  factRow: (gap: number) =>
    ({ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: gap / 2 }) as const,
  presenceRow: (gap: number) => ({ flexDirection: 'row', alignItems: 'center', gap }) as const,
};
