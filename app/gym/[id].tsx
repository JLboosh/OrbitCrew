import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  RATING_AXES,
  useActiveSession,
  useCheckIn,
  useCheckOut,
  useGym,
  useGymFriendVisits,
  useGymPresence,
  useGymRatingSummary,
  useMyGymRating,
  useMyGymVisitPattern,
  useMyPresence,
  useSubmitGymRating,
  useUpdateGymRating,
  type RatingAxis,
} from '@/api';
import { joinNames } from '@/components/gyms';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { hourLabel } from '@/lib/challengeRules';
import { errorMessage } from '@/lib/errors';
import { readOpeningHours } from '@/lib/openingHours';
import { useTheme } from '@/theme';

/**
 * Gym detail — everything needed to decide whether to train here.
 *
 * RATING RULES ENFORCED BY THE DATABASE, SURFACED HERE
 *   * One NEW rating per member per gym per 30 days, enforced by a trigger. The
 *     rejection message mentions "30 days" and is shown verbatim rather than
 *     replaced with a generic failure.
 *   * Revising an existing rating is always allowed, which is why the form
 *     switches to an update when the member already has one.
 *   * All seven axes run 1-5 and `crowding` is oriented so HIGHER IS BETTER
 *     (5 = pleasantly quiet), matching every other axis. It is labelled "Space to
 *     train" so the direction reads correctly, and it is never inverted.
 *
 * PRIVACY
 *   * Friend visits arrive as a count plus names only for members who share
 *     gym-level detail. The two are shown as separate facts, so the aggregate
 *     cannot be used to infer who the unnamed people are.
 *   * Live presence is pre-filtered server-side and will be empty for almost
 *     everyone, because sharing it is off by default.
 *   * "Your history here" is the member's OWN data and is labelled as such. It is
 *     explicitly not a crowd forecast.
 */
export default function GymDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: gym, isLoading } = useGym(id);
  const { data: summary } = useGymRatingSummary(id);
  const { data: visits } = useGymFriendVisits(id);
  const { data: presence } = useGymPresence(id);
  const { data: myVisits } = useMyGymVisitPattern(id);
  const { data: myPresence } = useMyPresence();
  const { data: activeSession } = useActiveSession();

  const checkIn = useCheckIn();
  const checkOut = useCheckOut();

  if (isLoading) {
    return (
      <Screen title="Gym">
        <Text tone="muted">Loading…</Text>
      </Screen>
    );
  }

  if (!gym || !id) {
    return (
      <Screen title="Gym">
        <Card>
          <Text variant="subheading">Gym not found</Text>
          <Text variant="caption" tone="muted">
            It may have been reported as closed and hidden from the directory.
          </Text>
        </Card>
      </Screen>
    );
  }

  const hours = readOpeningHours(gym.opening_hours);
  const ratingCount = Number(summary?.rating_count ?? 0);

  // Narrowed to a value rather than a boolean so `expires_at` is reachable
  // without a non-null assertion.
  const presenceHere = myPresence && myPresence.gym_id === gym.id ? myPresence : null;

  return (
    <Screen title={gym.name} subtitle={gym.address ?? gym.city ?? undefined}>
      {/* Photo and description, when a member supplied them. Above the check-in
          card because they answer "is this the right place" — which is the
          question you have before you have the question "should I check in". */}
      {gym.image_url || gym.description ? (
        <Card style={{ gap: theme.spacing.sm }}>
          {gym.image_url ? (
            <Image
              source={{ uri: gym.image_url }}
              accessibilityLabel={`Photo of ${gym.name}`}
              resizeMode="cover"
              style={[styles.photo, { borderRadius: theme.radius.md }]}
            />
          ) : null}
          {gym.description ? <Text variant="body">{gym.description}</Text> : null}
          {gym.source === 'user' ? (
            <Text variant="caption" tone="subtle">
              Added by a member, so the details are theirs rather than OpenStreetMap&apos;s. Report
              it if anything is wrong.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Check in. The primary action on this screen. */}
      <Card>
        {presenceHere ? (
          <>
            <Text variant="subheading" tone="success">
              You are checked in here
            </Text>
            <Text variant="caption" tone="muted">
              Ends automatically by{' '}
              {new Date(presenceHere.expires_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              , or check out now.
            </Text>
            <Button
              label="Check out"
              variant="ghost"
              loading={checkOut.isPending}
              onPress={() => checkOut.mutate()}
            />
          </>
        ) : (
          <>
            <Button
              label="Check in here"
              size="large"
              fullWidth
              loading={checkIn.isPending}
              onPress={() =>
                checkIn.mutate({ gymId: gym.id, sessionId: activeSession?.id ?? null })
              }
            />
            <Text variant="caption" tone="subtle">
              Shares the gym name — never your coordinates — with the people you chose in Privacy.
              Expires within three hours whatever happens.
            </Text>
            {checkIn.isError ? (
              <Text variant="caption" tone="danger">
                {errorMessage(checkIn.error, 'Could not check in. Please try again.')}
              </Text>
            ) : null}
          </>
        )}
      </Card>

      {/* Hours and contact. */}
      {gym.opening_hours || gym.phone || gym.website ? (
        <Card>
          <Text variant="subheading" heading>
            Opening hours
          </Text>
          {hours ? (
            <>
              <Text variant="body" tone={hours.isOpenNow === true ? 'success' : 'default'}>
                {openLabel(hours.isOpenNow)}
              </Text>
              <Text variant="caption" tone="muted">
                {hours.todayLabel ?? hours.raw}
              </Text>
              {/* When the OSM expression falls outside the supported subset it is
                  shown verbatim rather than guessed at. Telling someone a gym is
                  closed when it is open is the worst outcome here. */}
              {!hours.understood ? (
                <Text variant="caption" tone="subtle">
                  Listed as “{hours.raw}”. That format could not be read reliably, so treat it as a
                  guide.
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="caption" tone="muted">
              No hours listed for this gym.
            </Text>
          )}
          {gym.phone ? (
            <Text variant="caption" tone="muted">
              {gym.phone}
            </Text>
          ) : null}
          {gym.website ? (
            <Text variant="caption" tone="subtle" numberOfLines={1}>
              {gym.website}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Ratings across all seven axes. */}
      <Card>
        <Text variant="subheading" heading>
          Ratings
        </Text>
        {ratingCount > 0 ? (
          <>
            <Text variant="metric">{Number(summary?.avg_overall ?? 0).toFixed(1)}</Text>
            <Text variant="caption" tone="muted">
              {ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'}
            </Text>
            <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
              <AxisBar label="Air conditioning" value={summary?.avg_air_conditioning} />
              <AxisBar label="Equipment quality" value={summary?.avg_equipment_quality} />
              <AxisBar label="Equipment availability" value={summary?.avg_equipment_availability} />
              <AxisBar label="Cleanliness" value={summary?.avg_cleanliness} />
              <AxisBar label="Space to train" value={summary?.avg_crowding} />
              <AxisBar label="Value for money" value={summary?.avg_value_for_money} />
            </View>
          </>
        ) : (
          <Text variant="caption" tone="muted">
            No ratings yet. Yours would be the first.
          </Text>
        )}
      </Card>

      <RatingForm gymId={gym.id} />

      {/* Friend history: the count and the names are separate facts. */}
      <Card>
        <Text variant="subheading" heading>
          People you know
        </Text>
        {visits && visits.visitorCount > 0 ? (
          <>
            <Text variant="body">
              {visits.visitorCount} {visits.visitorCount === 1 ? 'person' : 'people'} you know{' '}
              {visits.visitorCount === 1 ? 'has' : 'have'} trained here.
            </Text>
            {visits.namedVisitors.length > 0 ? (
              <Text variant="caption" tone="muted">
                {joinNames(visits.namedVisitors.map((visitor) => visitor.displayName))}
              </Text>
            ) : (
              <Text variant="caption" tone="subtle">
                Nobody here has chosen to share which gym they train at, so no names are shown.
              </Text>
            )}
          </>
        ) : (
          <Text variant="caption" tone="muted">
            None of your friends or crew mates have trained here yet.
          </Text>
        )}

        {presence && presence.length > 0 ? (
          <Text variant="body" tone="accent">
            {joinNames(presence.map((member) => member.display_name))}{' '}
            {presence.length === 1 ? 'is' : 'are'} checked in right now.
          </Text>
        ) : null}
      </Card>

      {/* The member's OWN pattern, deliberately not framed as a crowd forecast. */}
      {myVisits && myVisits.visitCount > 0 ? (
        <Card>
          <Text variant="subheading" heading>
            Your history here
          </Text>
          <Text variant="body">
            {myVisits.visitCount} {myVisits.visitCount === 1 ? 'session' : 'sessions'}
            {myVisits.usualHour !== null ? `, usually around ${hourLabel(myVisits.usualHour)}` : ''}
          </Text>
          {myVisits.lastVisitedAt ? (
            <Text variant="caption" tone="muted">
              Last trained{' '}
              {new Date(myVisits.lastVisitedAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          ) : null}
          <Text variant="caption" tone="subtle">
            This is your own history, not how busy the gym is. A shared busy-times signal needs
            aggregated check-ins from members who opted in, which is not built yet.
          </Text>
        </Card>
      ) : null}

      <Text variant="caption" tone="subtle">
        Gym data © OpenStreetMap contributors
      </Text>
    </Screen>
  );
}

/** Never claims "closed" when the hours expression was not understood. */
function openLabel(isOpenNow: boolean | null): string {
  if (isOpenNow === true) return 'Open now';
  if (isOpenNow === false) return 'Closed now';
  return 'Hours as listed';
}

/** One rating axis as an average out of 5. Higher is always better. */
function AxisBar({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) {
    return (
      <Text variant="caption" tone="subtle">
        {label} — not rated
      </Text>
    );
  }

  const rounded = Math.round(Number(value) * 10) / 10;
  return <ProgressBar label={label} value={rounded} target={5} />;
}

/**
 * Submit or revise a rating.
 *
 * Switches between insert and update depending on whether the member already has
 * one, because the 30-day limit applies only to NEW ratings. The database enforces
 * that; this only avoids offering an action that would be rejected.
 */
function RatingForm({ gymId }: { gymId: string }) {
  const theme = useTheme();

  const { data: myRating } = useMyGymRating(gymId);
  const submit = useSubmitGymRating();
  const update = useUpdateGymRating();

  const [values, setValues] = useState<Partial<Record<RatingAxis, number>>>({});
  const [reviewText, setReviewText] = useState('');
  const [expanded, setExpanded] = useState(false);

  // Prefilled exactly once. Keyed on a ref rather than just the effect deps
  // because a background refetch would otherwise overwrite edits in progress.
  const prefilled = useRef(false);

  useEffect(() => {
    if (!myRating || prefilled.current) return;
    prefilled.current = true;

    setValues({
      overall: myRating.overall,
      air_conditioning: myRating.air_conditioning ?? undefined,
      equipment_quality: myRating.equipment_quality ?? undefined,
      equipment_availability: myRating.equipment_availability ?? undefined,
      cleanliness: myRating.cleanliness ?? undefined,
      crowding: myRating.crowding ?? undefined,
      value_for_money: myRating.value_for_money ?? undefined,
    });
    setReviewText(myRating.review_text ?? '');
  }, [myRating]);

  const overall = values.overall;
  const pending = submit.isPending || update.isPending;
  const error = submit.error ?? update.error;

  const setAxis = (key: RatingAxis, score: number) => {
    setValues((current) => {
      const next: Partial<Record<RatingAxis, number>> = { ...current };
      next[key] = score;
      return next;
    });
  };

  const onSubmit = () => {
    if (!overall) return;

    if (myRating) {
      update.mutate({
        ratingId: myRating.id,
        gymId,
        patch: {
          overall,
          air_conditioning: values.air_conditioning ?? null,
          equipment_quality: values.equipment_quality ?? null,
          equipment_availability: values.equipment_availability ?? null,
          cleanliness: values.cleanliness ?? null,
          crowding: values.crowding ?? null,
          value_for_money: values.value_for_money ?? null,
          review_text: reviewText.trim() || null,
        },
      });
      return;
    }

    submit.mutate({
      gymId,
      overall,
      airConditioning: values.air_conditioning ?? null,
      equipmentQuality: values.equipment_quality ?? null,
      equipmentAvailability: values.equipment_availability ?? null,
      cleanliness: values.cleanliness ?? null,
      crowding: values.crowding ?? null,
      valueForMoney: values.value_for_money ?? null,
      reviewText: reviewText.trim() || null,
    });
  };

  if (!expanded) {
    return (
      <Card>
        <Text variant="subheading" heading>
          {myRating ? 'Your rating' : 'Rate this gym'}
        </Text>
        <Text variant="caption" tone="muted">
          {myRating
            ? `You rated it ${myRating.overall} out of 5. You can revise that any time.`
            : 'Separate scores for air conditioning, equipment, space, and value, because a good gym means different things to different people.'}
        </Text>
        <Button
          label={myRating ? 'Revise rating' : 'Add rating'}
          variant="secondary"
          onPress={() => setExpanded(true)}
        />
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="subheading" heading>
        {myRating ? 'Revise your rating' : 'Rate this gym'}
      </Text>

      {RATING_AXES.map((axis) => (
        <ScorePicker
          key={axis.key}
          label={axis.label}
          required={axis.required}
          value={values[axis.key]}
          onChange={(score) => setAxis(axis.key, score)}
        />
      ))}

      <Text variant="caption" tone="subtle">
        Higher is better on every scale, including space to train, where 5 means pleasantly quiet.
      </Text>

      <TextInput
        value={reviewText}
        onChangeText={setReviewText}
        placeholder="Anything worth knowing? (optional)"
        placeholderTextColor={theme.colors.textSubtle}
        multiline
        maxLength={1000}
        accessibilityLabel="Review text, optional"
        style={[
          styles.reviewInput,
          {
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceMuted,
            color: theme.colors.text,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
          },
        ]}
      />

      <View style={[styles.formActions, { gap: theme.spacing.sm }]}>
        <Button
          label={myRating ? 'Save changes' : 'Submit rating'}
          loading={pending}
          disabled={!overall}
          onPress={onSubmit}
        />
        <Button label="Cancel" variant="ghost" onPress={() => setExpanded(false)} />
      </View>

      {!overall ? (
        <Text variant="caption" tone="subtle">
          An overall score is required. Every other axis is optional.
        </Text>
      ) : null}

      {/* The database's 30-day message is shown as written: it explains exactly
          why the submission was refused. */}
      {error ? (
        <Text variant="caption" tone="danger">
          {errorMessage(error, 'Could not save your rating.')}
        </Text>
      ) : null}

      {submit.isSuccess || update.isSuccess ? (
        <Text variant="caption" tone="success">
          Saved. Thanks — this is what makes the directory useful to everyone else.
        </Text>
      ) : null}
    </Card>
  );
}

function ScorePicker({
  label,
  required,
  value,
  onChange,
}: {
  label: string;
  required: boolean;
  value: number | undefined;
  onChange: (score: number) => void;
}) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
        {required ? ' (required)' : ''}
      </Text>
      <View style={[styles.scoreRow, { gap: theme.spacing.xs }]}>
        {[1, 2, 3, 4, 5].map((score) => {
          const active = value === score;
          return (
            <Pressable
              key={score}
              onPress={() => onChange(score)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}, ${score} out of 5`}
              style={{
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: active ? theme.colors.primary : theme.colors.border,
                backgroundColor: active ? theme.colors.primary : 'transparent',
              }}
            >
              <Text
                variant="body"
                style={{ color: active ? theme.colors.textOnPrimary : theme.colors.textMuted }}
              >
                {score}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    height: 180,
  },
  reviewInput: {
    borderWidth: 1,
    minHeight: 88,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
