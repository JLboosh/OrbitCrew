import { useState } from 'react';
import { View } from 'react-native';

import {
  useMyPrivacySettings,
  useMyProfile,
  useRemoveAvatar,
  useUpdatePrivacySettings,
  useUpdateProfile,
  useUploadAvatar,
  type PresenceVisibility,
} from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Screen,
  SettingSwitch,
  Text,
  TextField,
  useConfirm,
} from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { imagePicker } from '@/lib/imagePicker';
import { useAppearance, useTheme, type ThemeMode } from '@/theme';

/** Matches `profiles_display_name_length`, so the form rejects before the database. */
const MAX_DISPLAY_NAME = 50;

/**
 * Mirrors `profiles_username_format` exactly.
 *
 * Kept in step deliberately: validating client-side means a rejection is explained
 * in plain language instead of arriving as a constraint-violation code, but the
 * database is still what guarantees it.
 */
const USERNAME_MIN = 3;
const USERNAME_MAX = 24;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/;

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
      <IdentityCard />

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
      <AppearanceCard />

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

/**
 * Name and picture — the two things a member should obviously be able to change,
 * and previously could not: this card was read-only text.
 *
 * NICKNAME, NOT USERNAME. `display_name` is what appears everywhere in the app and
 * is free to change. `username` is the handle friends search for, is `citext`
 * UNIQUE with a strict format, and changing it would silently break anyone who had
 * saved it — so it is shown here to be copied, not edited.
 */
function IdentityCard() {
  const theme = useTheme();
  const { data: profile } = useMyProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();

  // Undefined means "not being edited", which is different from an empty string.
  // Seeding from the profile on every render would fight the member's typing.
  const [draftName, setDraftName] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);

  const savedName = profile?.display_name ?? '';
  const name = draftName ?? savedName;
  const trimmed = name.trim();
  const changed = trimmed !== savedName;
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_DISPLAY_NAME;

  const saveName = () => {
    if (!changed || !valid) return;
    setNameError(null);
    updateProfile.mutate(
      { display_name: trimmed },
      {
        onSuccess: () => setDraftName(undefined),
        onError: (err) => setNameError(errorMessage(err, 'Could not save your name.')),
      },
    );
  };

  const changePicture = async () => {
    setPictureError(null);
    try {
      const picked = await imagePicker.pick();
      // Null means the member closed the file dialog, which is not an error.
      if (!picked) return;
      await uploadAvatar.mutateAsync(picked);
    } catch (err) {
      setPictureError(errorMessage(err, 'Could not upload that picture.'));
    }
  };

  const clearPicture = async () => {
    setPictureError(null);
    try {
      await removeAvatar.mutateAsync();
    } catch (err) {
      setPictureError(errorMessage(err, 'Could not remove your picture.'));
    }
  };

  const busy = uploadAvatar.isPending || removeAvatar.isPending;

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
        {profile ? (
          <Avatar
            id={profile.id}
            name={profile.display_name}
            imageUrl={profile.avatar_url}
            size={72}
          />
        ) : null}

        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant="subheading">@{profile?.username ?? '—'}</Text>
          <Text variant="caption" tone="subtle">
            This is the handle friends search for. Share it exactly as written.
          </Text>
        </View>
      </View>

      {/* Picture controls. */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <Button
          label={profile?.avatar_url ? 'Change picture' : 'Add a picture'}
          variant="secondary"
          icon="image-outline"
          loading={uploadAvatar.isPending}
          disabled={!imagePicker.supported || busy}
          onPress={() => void changePicture()}
        />
        {profile?.avatar_url ? (
          <Button
            label="Remove"
            variant="ghost"
            loading={removeAvatar.isPending}
            disabled={busy}
            onPress={() => void clearPicture()}
          />
        ) : null}
      </View>

      {imagePicker.supported ? (
        <Text variant="caption" tone="subtle">
          JPEG, PNG, or WebP, up to 2 MB. Your picture is shown to people who can already see your
          profile, and it is served from a public link — so treat it as public.
        </Text>
      ) : (
        <Text variant="caption" tone="subtle">
          {imagePicker.unsupportedReason}
        </Text>
      )}

      {pictureError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {pictureError}
        </Text>
      ) : null}

      {/* Nickname. */}
      <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        <TextField
          label="Nickname"
          hint="What your crew sees. Change it whenever you like."
          value={name}
          onChangeText={(next) => {
            setDraftName(next);
            setNameError(null);
          }}
          maxLength={MAX_DISPLAY_NAME}
          autoCapitalize="words"
          error={nameError}
          onSubmitEditing={saveName}
          returnKeyType="done"
        />

        {changed ? (
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            <Button
              label="Save"
              loading={updateProfile.isPending}
              disabled={!valid}
              onPress={saveName}
            />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setDraftName(undefined);
                setNameError(null);
              }}
            />
          </View>
        ) : null}
      </View>

      <UsernameEditor />

      <Text variant="caption" tone="subtle">
        Times are shown in {profile?.timezone ?? 'UTC'}
      </Text>
    </Card>
  );
}

/**
 * Changing your handle.
 *
 * WHY THIS NEEDED TO EXIST. The handle is GENERATED at signup — from the email
 * local part, padded to the 3-character minimum, so `j@example.com` becomes
 * `lifterj`. The signup form never asked for one and nothing could change it
 * afterwards, so members ended up with a handle they did not choose, could not
 * guess, and could not share. Since an exact handle is the only way to find anyone
 * (by design — a prefix search would let a client enumerate every account), an
 * unchangeable generated handle made the friend search effectively unusable.
 *
 * Collapsed by default: most people never touch it, and a rename is not something
 * to fall into by accident.
 */
function UsernameEditor() {
  const theme = useTheme();
  const { data: profile } = useMyProfile();
  const updateProfile = useUpdateProfile();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = profile?.username ?? '';
  const value = draft ?? current;
  // Typing "@sam" is the natural thing to do; accept it and strip it.
  const handle = value.trim().replace(/^@+/, '');

  const changed = handle.toLowerCase() !== current.toLowerCase();
  const wellFormed = USERNAME_PATTERN.test(handle);

  const save = () => {
    setError(null);
    setSaved(false);

    if (!wellFormed) {
      setError(
        `Handles are ${USERNAME_MIN}-${USERNAME_MAX} characters, using letters, numbers, or underscores.`,
      );
      return;
    }

    updateProfile.mutate(
      { username: handle },
      {
        onSuccess: () => {
          setDraft(undefined);
          setOpen(false);
          setSaved(true);
        },
        onError: (err) => {
          // The unique index on a citext column is what makes two Sams
          // impossible; its raw message is not worth showing anyone.
          const code = (err as { code?: string }).code;
          setError(
            code === '23505'
              ? `@${handle} is already taken. Try another.`
              : errorMessage(err, 'Could not change your handle.'),
          );
        },
      },
    );
  };

  if (!open) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <Button
          label="Change handle"
          variant="ghost"
          onPress={() => {
            setOpen(true);
            setSaved(false);
          }}
        />
        {saved ? (
          <Text variant="caption" tone="success" accessibilityLiveRegion="polite">
            Handle updated. Share @{current} with friends.
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <TextField
        label="Handle"
        hint={`${USERNAME_MIN}-${USERNAME_MAX} characters: letters, numbers, or underscores.`}
        value={value}
        onChangeText={(next) => {
          setDraft(next);
          setError(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={USERNAME_MAX + 1}
        error={error}
        onSubmitEditing={save}
        returnKeyType="done"
      />

      <Text variant="caption" tone="subtle">
        Anyone searching your old handle will not find you afterwards, so tell the people who have
        it.
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <Button
          label="Save handle"
          loading={updateProfile.isPending}
          disabled={!changed || !wellFormed}
          onPress={save}
        />
        <Button
          label="Cancel"
          variant="ghost"
          onPress={() => {
            setDraft(undefined);
            setError(null);
            setOpen(false);
          }}
        />
      </View>
    </View>
  );
}

/**
 * Light / dark / follow-system.
 *
 * Kept out of `@/api` on purpose: the preference is stored on the device, not on
 * the profile. Dark mode is a property of WHERE you are — a phone in a dimly lit
 * gym versus a laptop at a desk — so syncing it between devices would be the
 * wrong behaviour, and a local value also applies on the sign-in screen, before
 * there is a profile to read.
 */
function AppearanceCard() {
  const theme = useTheme();
  const { mode, resolved, setMode, hydrated } = useAppearance();

  return (
    <Card>
      <Text variant="subheading" heading>
        Appearance
      </Text>
      <Text variant="caption" tone="muted">
        Dark mode keeps the same colours and contrast ratios, just inverted — progress bars, badges,
        and charts stay readable either way.
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
        {APPEARANCE_OPTIONS.map((option) => {
          const selected = mode === option.value;
          return (
            <Button
              key={option.value}
              label={option.label}
              variant={selected ? 'primary' : 'ghost'}
              disabled={!hydrated}
              accessibilityState={{ selected }}
              accessibilityHint={option.hint}
              onPress={() => setMode(option.value)}
            />
          );
        })}
      </View>

      <Text variant="caption" tone="subtle">
        {mode === 'system'
          ? `Following your device, which is currently ${resolved}.`
          : `Always ${mode}, whatever your device is set to.`}
      </Text>
    </Card>
  );
}

const APPEARANCE_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follows your device setting and changes with it.' },
  { value: 'light', label: 'Light', hint: 'Always the light theme.' },
  { value: 'dark', label: 'Dark', hint: 'Always the dark theme.' },
];

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
