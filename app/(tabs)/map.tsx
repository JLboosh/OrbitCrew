import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useGymSearch, useMyProfile, useNearbyGyms, type NearbyGym } from '@/api';
import { GymListRow, GymMapView, SelectedGymCard } from '@/components/gyms';
import { Button, Card, Screen, Text } from '@/components/ui';
import { useDeviceLocation } from '@/lib/deviceLocation';
import {
  distanceSystemForWeightUnit,
  formatRadius,
  RADIUS_CHOICES,
  type DistanceSystem,
} from '@/lib/geo';
import { useTheme } from '@/theme';

/**
 * Map — discover gyms and the social activity around them.
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
 * The map itself is a schematic plot rather than a tile map; see the comment in
 * GymMapView for why, and for how to swap MapLibre in behind the same props.
 */
export default function MapScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: profile } = useMyProfile();
  const location = useDeviceLocation();

  const [radiusMetres, setRadiusMetres] = useState<number>(5000);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const distanceSystem = distanceSystemForWeightUnit(profile?.weight_unit ?? 'lb');

  const nearby = useNearbyGyms(location.coords, radiusMetres, 50);
  const search = useGymSearch(searchQuery);

  const gyms = nearby.data ?? [];
  const selectedGym = gyms.find((gym) => gym.id === selectedGymId) ?? null;

  const openGym = (gymId: string) => router.push(`/gym/${gymId}`);
  const onSelectGym = (gym: NearbyGym) => setSelectedGymId(gym.id);

  return (
    <Screen title="Map" subtitle="Find gyms near you.">
      {/* Location gate. Asked for on tap rather than on mount: a permission
          prompt the member did not initiate feels like the app taking something. */}
      {location.coords === null ? (
        <Card>
          <Text variant="subheading">Find gyms around you</Text>
          <Text variant="caption" tone="muted">
            Your location is used once, to ask which gyms are nearby. It is not saved, not shared,
            and never tracked in the background.
          </Text>
          {location.supported ? (
            <Button
              label="Use my location"
              loading={location.status === 'requesting'}
              onPress={location.request}
            />
          ) : null}
          {location.message ? (
            <Text variant="caption" tone="subtle">
              {location.message}
            </Text>
          ) : null}
          {!location.supported ? (
            <Text variant="caption" tone="subtle">
              This build cannot read device location yet, so nearby search is unavailable. You can
              still find a gym by name below.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Nearby results. */}
      {location.coords ? (
        <>
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
            <Card>
              <Text variant="caption" tone="muted">
                Looking for gyms nearby…
              </Text>
            </Card>
          ) : nearby.isError ? (
            <Card>
              <Text variant="caption" tone="danger">
                Could not load nearby gyms.
              </Text>
              <Button label="Try again" variant="secondary" onPress={() => nearby.refetch()} />
            </Card>
          ) : gyms.length === 0 ? (
            <Card>
              <Text variant="subheading">
                No gyms within {formatRadius(radiusMetres, distanceSystem)}
              </Text>
              <Text variant="caption" tone="muted">
                Try a wider radius, or search by name below.
              </Text>
            </Card>
          ) : (
            <>
              <GymMapView
                origin={location.coords}
                gyms={gyms}
                radiusMetres={radiusMetres}
                selectedGymId={selectedGymId}
                onSelectGym={onSelectGym}
                distanceSystem={distanceSystem}
              />

              {selectedGym ? (
                <SelectedGymCard
                  gym={selectedGym}
                  distanceSystem={distanceSystem}
                  onOpenDetail={openGym}
                />
              ) : (
                <Text variant="caption" tone="subtle">
                  Tap a pin or a gym below for ratings, who has trained there, and check-in.
                </Text>
              )}

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
            </>
          )}
        </>
      ) : null}

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
        Gym data © OpenStreetMap contributors
      </Text>
    </Screen>
  );
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
