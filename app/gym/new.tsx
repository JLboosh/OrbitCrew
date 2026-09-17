import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import {
  useCreateGym,
  useMyProfile,
  useNearbyGyms,
  useSimilarGyms,
  type SimilarGymRow,
} from '@/api';
import { GymMapView } from '@/components/gyms';
import { Button, Card, Screen, Text, TextField } from '@/components/ui';
import { CAMPUS_CENTRE } from '@/lib/campus';
import { useDeviceLocation } from '@/lib/deviceLocation';
import { errorMessage } from '@/lib/errors';
import { distanceSystemForWeightUnit, formatDistance, isValidLatLng, type LatLng } from '@/lib/geo';
import { useTheme } from '@/theme';

/** Radius of the reference map. Wide enough for context, tight enough to aim in. */
const PICKER_RADIUS_METRES = 2000;

/**
 * Add a gym that is not in the directory.
 *
 * WHY A MEMBER CAN WRITE TO THE SHARED DIRECTORY AT ALL
 * ----------------------------------------------------
 * The gym table is imported from OpenStreetMap, and OSM does not know about the
 * basement gym in a student residence or the one that opened last month. Without
 * this, those members cannot check in, cannot rate, and cannot attach a session to
 * where they actually train.
 *
 * It goes through the `create_user_gym` RPC, not an INSERT: `public.gyms` has no
 * INSERT policy, so validation, the rate limit, and duplicate refusal are enforced
 * by the database rather than by this screen. That matters because this screen is
 * the friendly path, not the security boundary.
 *
 * DUPLICATES ARE A CONVERSATION, NOT A REJECTION. The server would refuse a
 * probable duplicate outright, which from the member's side is a dead end after
 * they have typed a name and aimed a pin. So similar gyms are looked up as they
 * type and shown as a choice: open the one that exists, or confirm and add yours.
 * Most people take the existing gym, which is what actually keeps the directory
 * clean.
 */
export default function AddGymScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();

  const { data: profile } = useMyProfile();
  const location = useDeviceLocation();
  const create = useCreateGym();

  const distanceSystem = distanceSystemForWeightUnit(profile?.weight_unit ?? 'lb');

  // Opens wherever the member was looking on the map, so the pin starts near the
  // gym they are adding rather than in another city.
  const initialCentre = parseLatLng(params.lat, params.lng) ?? CAMPUS_CENTRE;

  const [centre, setCentre] = useState<LatLng>(initialCentre);
  const [pin, setPin] = useState<LatLng | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Existing gyms nearby, drawn on the picker for reference so a member can SEE
  // that the gym they are adding is already there.
  const { data: nearby } = useNearbyGyms(centre, PICKER_RADIUS_METRES, 30);

  const similar = useSimilarGyms(
    pin && name.trim().length >= 2
      ? { name, latitude: pin.latitude, longitude: pin.longitude, address }
      : null,
  );

  const candidates = similar.data ?? [];
  const probableDuplicate = candidates.find((candidate) => candidate.is_probable_duplicate) ?? null;

  const trimmedName = name.trim();
  const ready = trimmedName.length >= 2 && pin !== null;
  const needsAcknowledgement = probableDuplicate !== null && !acknowledgedDuplicate;

  const submit = async () => {
    if (!ready || !pin) return;
    setError(null);

    try {
      const gymId = await create.mutateAsync({
        name: trimmedName,
        latitude: pin.latitude,
        longitude: pin.longitude,
        address,
        city,
        description,
        website,
        imageUrl,
        confirmPossibleDuplicate: acknowledgedDuplicate,
      });

      // Straight to the gym page: it is a normal gym now, so the member can rate
      // it, check in, or start a workout there immediately.
      router.replace(`/gym/${gymId}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not add that gym. Please try again.'));
    }
  };

  return (
    <Screen title="Add a gym" subtitle="For places the OpenStreetMap import does not know about.">
      {/* Location first: it is the one field that cannot be typed, and having the
          pin down makes the duplicate check meaningful. */}
      <Card>
        <Text variant="subheading" heading>
          1. Where is it?
        </Text>
        <Text variant="caption" tone="muted">
          Tap the map to drop a pin. Existing gyms are shown in green — if yours is already one of
          them, open it instead.
        </Text>

        <GymMapView
          origin={centre}
          gyms={nearby ?? []}
          radiusMetres={PICKER_RADIUS_METRES}
          distanceSystem={distanceSystem}
          onSelectGym={(gym) => router.push(`/gym/${gym.id}`)}
          onCentreChange={setCentre}
          hasDeviceLocation={location.coords !== null}
          pinMode
          pinLocation={pin}
          onPickLocation={(point) => {
            setPin(point);
            // A new location invalidates a duplicate the member already dismissed.
            setAcknowledgedDuplicate(false);
          }}
          height={theme.isWide ? 460 : 340}
        />

        {pin ? (
          <Text variant="caption" tone="success">
            Pin placed at {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
          </Text>
        ) : (
          <Text variant="caption" tone="subtle">
            No pin yet. The gym needs a location before it can be added.
          </Text>
        )}

        <View style={[styles.actions, { gap: theme.spacing.sm }]}>
          {location.supported && location.coords === null ? (
            <Button
              label="Use my location"
              variant="secondary"
              loading={location.status === 'requesting'}
              onPress={() => void location.request()}
            />
          ) : null}
          {location.coords ? (
            <Button
              label="Pin my location"
              variant="secondary"
              onPress={() => {
                setPin(location.coords);
                setCentre(location.coords!);
                setAcknowledgedDuplicate(false);
              }}
            />
          ) : null}
          {pin ? <Button label="Clear pin" variant="ghost" onPress={() => setPin(null)} /> : null}
        </View>

        {location.message ? (
          <Text variant="caption" tone="subtle">
            {location.message}
          </Text>
        ) : null}
      </Card>

      {/* Details. */}
      <Card>
        <Text variant="subheading" heading>
          2. What is it called?
        </Text>

        <TextField
          label="Gym name"
          value={name}
          onChangeText={(next) => {
            setName(next);
            setAcknowledgedDuplicate(false);
          }}
          placeholder="Columbia Icefield Fitness"
          autoCapitalize="words"
          maxLength={200}
        />

        <TextField
          label="Address (optional)"
          value={address}
          onChangeText={setAddress}
          placeholder="200 University Ave W"
          autoCapitalize="words"
          maxLength={300}
        />

        <TextField
          label="City (optional)"
          value={city}
          onChangeText={setCity}
          placeholder="Waterloo"
          autoCapitalize="words"
          maxLength={120}
        />

        <TextField
          label="Description (optional)"
          hint="Equipment, access, opening quirks — whatever you would want to know before going."
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={1000}
        />

        <TextField
          label="Website (optional)"
          value={website}
          onChangeText={setWebsite}
          placeholder="https://example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <TextField
          label="Photo link (optional)"
          hint="A link to an image. Uploading a photo is not supported yet, so a URL is the option that works on every platform."
          value={imageUrl}
          onChangeText={setImageUrl}
          placeholder="https://example.com/gym.jpg"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        {looksLikeUrl(imageUrl) ? (
          <Image
            source={{ uri: imageUrl.trim() }}
            accessibilityLabel="Preview of the photo you linked"
            resizeMode="cover"
            style={[styles.preview, { borderRadius: theme.radius.md }]}
          />
        ) : null}
      </Card>

      {/* Duplicate warning. */}
      {candidates.length > 0 ? (
        <Card variant="outline">
          <Text variant="subheading" heading>
            {probableDuplicate ? 'This may already be here' : 'Gyms near your pin'}
          </Text>
          <Text variant="caption" tone="muted">
            {probableDuplicate
              ? 'One of these looks like the same gym. Opening it keeps the ratings and check-ins together.'
              : 'Nothing matches by name, but these are close by. Worth a glance.'}
          </Text>

          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              onPress={() => router.push(`/gym/${candidate.id}`)}
              distanceLabel={formatDistance(candidate.distance_metres, distanceSystem)}
            />
          ))}

          {probableDuplicate ? (
            <Button
              label={
                acknowledgedDuplicate
                  ? 'Confirmed — this is a different gym'
                  : 'None of these — mine is different'
              }
              variant={acknowledgedDuplicate ? 'primary' : 'secondary'}
              onPress={() => setAcknowledgedDuplicate(true)}
              accessibilityState={{ selected: acknowledgedDuplicate }}
            />
          ) : null}
        </Card>
      ) : null}

      <Button
        label="Add gym"
        size="large"
        fullWidth
        disabled={!ready || needsAcknowledgement}
        loading={create.isPending}
        onPress={submit}
      />

      {!ready ? (
        <Text variant="caption" tone="subtle">
          A name and a pin are required. Everything else is optional.
        </Text>
      ) : needsAcknowledgement ? (
        <Text variant="caption" tone="subtle">
          Confirm above that your gym is not one of the ones listed, and this unlocks.
        </Text>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Text variant="caption" tone="subtle">
        Added gyms are visible to everyone and behave like any other gym — searchable, rateable, and
        available to check in at. Existing gym data © OpenStreetMap contributors.
      </Text>
    </Screen>
  );
}

function CandidateRow({
  candidate,
  distanceLabel,
  onPress,
}: {
  candidate: SimilarGymRow;
  distanceLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${candidate.name}, ${distanceLabel} from your pin. ${matchReasonLabel(
        candidate.match_reason,
      )}`}
      accessibilityHint="Opens this gym instead of adding a new one."
      onPress={onPress}
      style={({ pressed }) => [
        styles.candidate,
        {
          minHeight: theme.minTouchTarget,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.candidateBody}>
        <Text variant="body" numberOfLines={1}>
          {candidate.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {distanceLabel} away · {matchReasonLabel(candidate.match_reason)}
          {candidate.address ? ` · ${candidate.address}` : ''}
        </Text>
      </View>
      <Text variant="caption" tone="primary" style={{ fontWeight: '600' }}>
        Open
      </Text>
    </Pressable>
  );
}

/** Says WHY something was flagged, so the member can judge it rather than trust it. */
function matchReasonLabel(reason: string): string {
  switch (reason) {
    case 'same_name':
      return 'same name';
    case 'same_address':
      return 'same address';
    case 'similar_name':
      return 'similar name';
    default:
      return 'very close by';
  }
}

function parseLatLng(lat: string | undefined, lng: string | undefined): LatLng | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  const candidate = { latitude, longitude };
  return isValidLatLng(candidate) ? candidate : null;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S{3,}$/.test(value.trim());
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  preview: {
    width: '100%',
    height: 160,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  candidateBody: {
    flex: 1,
    gap: 2,
  },
});
