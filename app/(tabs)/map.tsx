import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  useGymPresenceByGymId,
  useGymSearch,
  useMyProfile,
  useNearbyGyms,
  type NearbyGym,
} from '@/api';
import { GymListRow, GymMapView, SelectedGymCard } from '@/components/gyms';
import { Button, Card, Screen, Text } from '@/components/ui';
import { CAMPUS_CENTRE, isWithinCampus } from '@/lib/campus';
import { useDeviceLocation } from '@/lib/deviceLocation';
import {
  distanceSystemForWeightUnit,
  formatRadius,
  RADIUS_CHOICES,
  type DistanceSystem,
  type LatLng,
} from '@/lib/geo';
import { useTheme } from '@/theme';

/**
 * Explore — discover gyms and the social activity around them.
 *
 * THREE SEPARATE CONCEPTS, kept separate on purpose:
 *   1. Nearby gyms       — places, from our PostGIS-indexed OpenStreetMap cache.
 *   2. Friend history    — "4 people you know have trained here."
 *   3. Live presence     — "Alex is checked in right now."
 * Only the first is available without any social graph, and the last is off by
 * default for everyone. Conflating them would leak the third through the second.
 *
 * PRIVACY PROPERTIES OF THIS SCREEN
 *   * The member's coordinate is used as a query argument and held in component
 *     state. It is never written anywhere, and nothing here persists it.
 *   * No marker is ever drawn at a USER's position — only at gyms. The schema has
 *     no column for a person's coordinates.
 *   * There is no heat map, no breadcrumb trail, and no movement history.
 *
 * WHY THE MAP OPENS ON CAMPUS RATHER THAN ASKING FOR LOCATION FIRST
 * ----------------------------------------------------------------
 * A permission prompt on arrival is the app taking something before it has shown
 * it is worth anything. Opening on the University of Waterloo campus — where the
 * 3D building data lives — means the map is immediately useful and explains
 * itself, and location becomes an offer ("show gyms near me") rather than a
 * gate. Nothing about the campus view needs to know where the member is.
 */
export default function MapScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const location = useDeviceLocation();

  const [radiusMetres, setRadiusMetres] = useState<number>(5000);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * Where gym results are measured from.
   *
   * Starts at campus and follows the map as the member pans, so panning to
   * another neighbourhood actually shows that neighbourhood's gyms. Granting
   * location moves it to the device position once.
   */
  const [queryOrigin, setQueryOrigin] = useState<LatLng>(CAMPUS_CENTRE);

  const distanceSystem = distanceSystemForWeightUnit(profile?.weight_unit ?? 'lb');

  const nearby = useNearbyGyms(queryOrigin, radiusMetres, 50);
  const search = useGymSearch(searchQuery);

  const gyms = nearby.data ?? [];
  const selectedGym = gyms.find((gym) => gym.id === selectedGymId) ?? null;

  // One extra query for the whole set of pins, not one per pin. See the hook.
  const { data: presenceByGymId } = useGymPresenceByGymId(gyms.map((gym) => gym.id));

  const openGym = (gymId: string) => router.push(`/gym/${gymId}`);
  const onSelectGym = (gym: NearbyGym) => setSelectedGymId(gym.id);

  /**
   * Re-query when the member pans somewhere genuinely different.
   *
   * Threshold rather than every camera move: `nearby_gyms` hits our own indexed
   * table so it is cheap, but a query per frame would still be pointless churn,
   * and the results barely change for a small nudge. Half the current radius is
   * the point at which the previous result set stops covering what is on screen.
   */
  const onCentreChange = useCallback(
    (centre: LatLng) => {
      setQueryOrigin((current) => {
        const moved = roughDistanceMetres(current, centre);
        return moved > radiusMetres / 2 ? centre : current;
      });
    },
    [radiusMetres],
  );

  const useMyLocation = useCallback(async () => {
    await location.request();
  }, [location]);

  // Applying granted coordinates as the query origin, once.
  const deviceCoords = location.coords;
  const hasDeviceLocation = deviceCoords !== null;
  if (deviceCoords && queryOrigin === CAMPUS_CENTRE) {
    // Safe during render: setState with a different value schedules one extra
    // pass, and the identity check makes it run exactly once.
    setQueryOrigin(deviceCoords);
  }

  const onCampus = isWithinCampus(queryOrigin);

  return (
    <Screen title="Explore" subtitle="Find gyms, and see who is training.">
      <GymMapView
        origin={queryOrigin}
        gyms={gyms}
        radiusMetres={radiusMetres}
        selectedGymId={selectedGymId}
        onSelectGym={onSelectGym}
        distanceSystem={distanceSystem}
        presenceByGymId={presenceByGymId}
        hasDeviceLocation={hasDeviceLocation}
        onCentreChange={onCentreChange}
        height={theme.isWide ? 560 : 400}
      />

      {selectedGym ? (
        <SelectedGymCard gym={selectedGym} distanceSystem={distanceSystem} onOpenDetail={openGym} />
      ) : (
        <Text variant="caption" tone="subtle">
          {gyms.length > 0
            ? 'Select a gym on the map or in the list for ratings, who is there, and check-in.'
            : onCampus
              ? 'Campus fitness centres appear as green markers.'
              : 'No gyms in view. Try a wider radius, or search by name below.'}
        </Text>
      )}

      {/*
        Adding a gym.
        Placed under the map rather than in the header because it is the answer to
        a question the map has just raised — "mine isn't here" — and the current
        map centre is handed over so the pin starts where the member was looking
        instead of back on campus.
      */}
      <Button
        label="Add a gym"
        icon="add-circle-outline"
        variant="secondary"
        fullWidth
        accessibilityHint="For a gym that is missing from the map."
        onPress={() =>
          router.push({
            pathname: '/gym/new',
            params: {
              lat: String(queryOrigin.latitude),
              lng: String(queryOrigin.longitude),
            },
          })
        }
      />

      {/* Location is an offer, not a gate: the map above already works without
          it. Asked for on tap so the prompt is always something the member
          initiated. */}
      {!hasDeviceLocation && location.supported ? (
        <Card variant="outline">
          <Text variant="caption" tone="muted">
            Showing the University of Waterloo campus. Your location is used once, to rank gyms by
            distance — it is not saved, not shared, and never tracked in the background.
          </Text>
          <Button
            label="Show gyms near me"
            variant="secondary"
            loading={location.status === 'requesting'}
            onPress={useMyLocation}
          />
          {location.message ? (
            <Text variant="caption" tone="subtle">
              {location.message}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {!location.supported ? (
        <Text variant="caption" tone="subtle">
          This build cannot read device location, so distances are measured from the map centre. You
          can still pan the map or search by name.
        </Text>
      ) : null}

      <RadiusPicker
        value={radiusMetres}
        onChange={(next) => {
          setRadiusMetres(next);
          // The selection may fall outside the new radius.
          setSelectedGymId(null);
        }}
        distanceSystem={distanceSystem}
      />

      {nearby.isLoading ? (
        <Text variant="caption" tone="muted">
          Looking for gyms…
        </Text>
      ) : nearby.isError ? (
        <Card>
          <Text variant="caption" tone="danger">
            Could not load gyms for this area.
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => nearby.refetch()} />
        </Card>
      ) : gyms.length === 0 ? (
        <Card>
          <Text variant="subheading">
            No gyms within {formatRadius(radiusMetres, distanceSystem)}
          </Text>
          <Text variant="caption" tone="muted">
            Try a wider radius, pan the map, or search by name below.
          </Text>
        </Card>
      ) : (
        <Card flush style={{ paddingHorizontal: theme.spacing.lg }}>
          {gyms.map((gym, index) => (
            <GymListRow
              key={gym.id}
              gym={gym}
              label={index + 1}
              selected={gym.id === selectedGymId}
              distanceSystem={distanceSystem}
              onPress={onSelectGym}
            />
          ))}
        </Card>
      )}

      {/* Search by name. Always available, and the only path when location is not. */}
      <Card>
        <Text variant="subheading" heading>
          Search by name or city
        </Text>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Gym or city name"
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Search gyms by name or city"
          style={[
            styles.input,
            {
              minHeight: theme.minTouchTarget,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceMuted,
              color: theme.colors.text,
            },
          ]}
        />

        {searchQuery.trim().length >= 2 ? (
          search.isLoading ? (
            <Text variant="caption" tone="muted">
              Searching…
            </Text>
          ) : search.data && search.data.length > 0 ? (
            <View>
              {search.data.map((gym) => (
                <Pressable
                  key={gym.id}
                  onPress={() => openGym(gym.id)}
                  accessibilityRole="button"
                  accessibilityLabel={gym.name}
                  style={({ pressed }) => [
                    styles.searchRow,
                    {
                      minHeight: theme.minTouchTarget,
                      borderBottomColor: theme.colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text variant="body" numberOfLines={1}>
                    {gym.name}
                  </Text>
                  {gym.address || gym.city ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {gym.address ?? gym.city}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {/* Search cannot show distance: gyms.location is PostGIS geography,
                  which PostgREST serialises as opaque WKB. Only nearby_gyms
                  projects it to latitude/longitude. */}
              <Text variant="caption" tone="subtle">
                Distances are shown for nearby results only.
              </Text>
            </View>
          ) : (
            <Text variant="caption" tone="muted">
              No gyms matched. The directory is imported per area, so somewhere new may not be in it
              yet.
            </Text>
          )
        ) : null}
      </Card>

      {/* Licence condition, not decoration. */}
      <Text variant="caption" tone="subtle">
        Gym locations and campus building footprints © OpenStreetMap contributors
      </Text>
    </Screen>
  );
}

/**
 * Rough metres between two coordinates, for the "has the member panned far
 * enough to re-query" test only.
 *
 * Equirectangular, matching `projectToUnitSquare`. Authoritative distances always
 * come from PostGIS via `nearby_gyms.distance_metres` — this is a threshold test,
 * not a number ever shown to anyone.
 */
function roughDistanceMetres(a: LatLng, b: LatLng): number {
  const metresPerDegreeLat = 111_320;
  const north = (b.latitude - a.latitude) * metresPerDegreeLat;
  const east =
    (b.longitude - a.longitude) * metresPerDegreeLat * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(north, east);
}

function RadiusPicker({
  value,
  onChange,
  distanceSystem,
}: {
  value: number;
  onChange: (metres: number) => void;
  distanceSystem: DistanceSystem;
}) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Search radius"
      style={[styles.radiusRow, { gap: theme.spacing.sm }]}
    >
      {RADIUS_CHOICES.map((choice) => {
        const active = choice === value;
        return (
          <Pressable
            key={choice}
            onPress={() => onChange(choice)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Within ${formatRadius(choice, distanceSystem)}`}
            style={{
              paddingVertical: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.pill,
              borderWidth: 1,
              borderColor: active ? theme.colors.primary : theme.colors.border,
              backgroundColor: active ? theme.colors.primarySoft : 'transparent',
            }}
          >
            <Text variant="caption" tone={active ? 'primary' : 'muted'}>
              {formatRadius(choice, distanceSystem)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    fontSize: 15,
  },
  searchRow: {
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  radiusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
