import { useState } from 'react';
import { View } from 'react-native';

import {
  useMyPrivacySettings,
  useMyProfile,
  useUpdatePrivacySettings,
  useUpdateProfile,
  type PresenceVisibility,
} from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Screen, SettingSwitch, Text, useConfirm } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Profile and privacy.
 *
 * The controls here are the product's central promise, so every one states its
 * consequence in plain language. A toggle a member does not understand is not
 * meaningful consent.
 *
 * Writes are optimistic: a privacy switch that lags makes members doubt whether
 * the change applied. The previous value is restored on failure, so the UI never
 * claims a protection that was not actually saved.
 */
export default function ProfileScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const confirm = useConfirm();

  const { data: profile } = useMyProfile();
  const { data: privacy, isLoading } = useMyPrivacySettings();
  const updatePrivacy = useUpdatePrivacySettings();
  const updateProfile = useUpdateProfile();

  const [error, setError] = useState<string | null>(null);

  function set(patch: Parameters<typeof updatePrivacy.mutate>[0]) {
    setError(null);
    updatePrivacy.mutate(patch, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not save.'),
    });
  }

  return (
    <Screen title="Profile" subtitle="You control everything below.">
      <Card>
        <Text variant="heading" heading>
          {profile?.display_name ?? '—'}
        </Text>
        <Text variant="caption" tone="muted">
          @{profile?.username ?? '—'}
        </Text>
        <Text variant="caption" tone="subtle">
          Times are shown in {profile?.timezone ?? 'UTC'}
        </Text>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <Text variant="subheading" heading>
          Live presence
        </Text>
        <Text variant="caption" tone="muted">
          Whether people can see that you are at a gym right now. This shares the gym name only —
          never your location on a map, and never a history of where you have been. It always ends
          automatically within 3 hours.
        </Text>

        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
          {PRESENCE_OPTIONS.map((option) => {
            const selected = privacy?.presence_visibility === option.value;
            return (
              <Button
                key={option.value}
                label={option.label}
                variant={selected ? 'primary' : 'ghost'}
                fullWidth
                disabled={isLoading}
                accessibilityState={{ selected }}
                accessibilityHint={option.hint}
                onPress={() => set({ presence_visibility: option.value })}
              />
            );
          })}
        </View>

        <Text variant="caption" tone="subtle" style={{ marginTop: theme.spacing.sm }}>
          {PRESENCE_OPTIONS.find((o) => o.value === privacy?.presence_visibility)?.hint ?? ''}
        </Text>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <Text variant="subheading" heading>
          What your crews see
        </Text>
        <Text variant="caption" tone="muted">
          Applies to every crew. You can make this stricter for an individual crew, but never
          looser.
        </Text>

        <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
          {DETAIL_OPTIONS.map((option) => {
            const selected = privacy?.default_activity_detail === option.value;
            return (
              <Button
                key={option.value}
                label={option.label}
                variant={selected ? 'primary' : 'ghost'}
                fullWidth
                disabled={isLoading}
                accessibilityState={{ selected }}
                accessibilityHint={option.hint}
                onPress={() => set({ default_activity_detail: option.value })}
              />
            );
          })}
        </View>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card flush style={{ paddingHorizontal: theme.spacing.lg }}>
        <View style={{ paddingTop: theme.spacing.lg }}>
          <Text variant="subheading" heading>
            Sharing
          </Text>
        </View>

        <SettingSwitch
          label="Share progress summaries"
          description="Let friends see your personal records, estimated one-rep max, and consistency. Off means your numbers stay yours."
          value={privacy?.share_progress_summary ?? false}
          disabled={isLoading}
          onValueChange={(v) => set({ share_progress_summary: v })}
        />

        <SettingSwitch
          label="Findable by username"
          description="Allows someone who already knows your exact username to send a friend request. Nobody can browse or search for you."
          value={privacy?.discoverable_by_username ?? false}
          disabled={isLoading}
          onValueChange={(v) => set({ discoverable_by_username: v })}
        />

        <SettingSwitch
          label="Motivation Spotlight"
          description="Opt in to a light-hearted weekly badge that can land on whoever trained least. Entirely optional, and never applied to people who have not opted in."
          value={privacy?.allow_motivation_spotlight ?? false}
          disabled={isLoading}
          onValueChange={(v) => set({ allow_motivation_spotlight: v })}
        />

        <View style={{ paddingBottom: theme.spacing.lg }}>
          <SettingSwitch
            label="Help build crowd patterns"
            description="Contribute your check-ins to anonymous busy-time estimates like 'usually busy Tuesday 5-7pm'. Aggregated only, never linked back to you."
            value={privacy?.contribute_to_crowd_stats ?? false}
            disabled={isLoading}
            onValueChange={(v) => set({ contribute_to_crowd_stats: v })}
          />
        </View>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card>
        <Text variant="subheading" heading>
          Units
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
          {(['lb', 'kg'] as const).map((unit) => {
            const selected = profile?.weight_unit === unit;
            return (
              <Button
                key={unit}
                label={unit === 'lb' ? 'Pounds' : 'Kilograms'}
                variant={selected ? 'primary' : 'ghost'}
                accessibilityState={{ selected }}
                onPress={() => updateProfile.mutate({ weight_unit: unit })}
              />
            );
          })}
        </View>
        <Text variant="caption" tone="subtle">
          Weights are stored exactly as you enter them, so switching units never alters your
          history.
        </Text>
      </Card>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Button
        label="Sign out"
        variant="ghost"
        fullWidth
        onPress={async () => {
          const confirmed = await confirm({
            title: 'Sign out?',
            message: 'You can sign back in at any time.',
            confirmLabel: 'Sign out',
            destructive: true,
          });
          if (confirmed) await signOut();
        }}
      />
    </Screen>
  );
}

const PRESENCE_OPTIONS: {
  value: PresenceVisibility;
  label: string;
  hint: string;
}[] = [
  {
    value: 'nobody',
    label: 'No one',
    hint: 'Your check-ins are recorded for your own history only. This is the default.',
  },
  { value: 'friends', label: 'Friends', hint: 'Only people you have accepted as friends.' },
  {
    value: 'selected_crews',
    label: 'Crews I choose',
    hint: 'Only the crews you specifically opt into, chosen per crew.',
  },
  { value: 'all_crews', label: 'All my crews', hint: 'Everyone in any crew you belong to.' },
];

const DETAIL_OPTIONS: {
  value: 'trained_only' | 'gym_name' | 'duration' | 'full_detail';
  label: string;
  hint: string;
}[] = [
  {
    value: 'trained_only',
    label: 'That I trained',
    hint: 'Your crew sees only that you trained. This is the default.',
  },
  { value: 'gym_name', label: 'Plus the gym', hint: 'Also shows which gym you trained at.' },
  { value: 'duration', label: 'Plus how long', hint: 'Also shows how long the session lasted.' },
  {
    value: 'full_detail',
    label: 'Everything',
    hint: 'Also shows exercises, sets, reps, and weights.',
  },
];
