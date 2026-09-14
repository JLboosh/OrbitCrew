import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  useChallengeTemplates,
  useCreateChallenge,
  useExercises,
  useMyCrews,
  useMyProfile,
  type ChallengeScope,
  type ChallengeTemplate,
} from '@/api';
import { Button, Card, Screen, Text } from '@/components/ui';
import { describeChallengeRule, parseChallengeRule } from '@/lib/challengeRules';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

/**
 * Create a challenge from a template.
 *
 * TEMPLATES, NOT HARD-CODED TYPES. Everything offered here is a row in
 * `challenge_templates`, so adding "5 sessions a week for 8 weeks" is an INSERT
 * rather than a change to this screen. The rule type determines which extra input
 * is needed — only `exercise_1rm_gain` needs one, an exercise to track.
 *
 * TIMEZONE IS CHOSEN DELIBERATELY, not defaulted. A crew challenge is scored in
 * the CREW's timezone and a personal one in the member's, so nobody is judged
 * against a clock they do not live in. `useCreateChallenge` requires it for
 * exactly that reason.
 *
 * CREW CHALLENGES ARE ADMIN-ONLY. This screen offers the crew option only where
 * the member is owner or admin, but the `challenges_insert_crew_admin` policy is
 * what actually guarantees it.
 */
export default function NewChallengeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { data: templates, isLoading: loadingTemplates } = useChallengeTemplates();
  const { data: crews } = useMyCrews();
  const { data: profile } = useMyProfile();
  const { data: exercises } = useExercises();
  const create = useCreateChallenge();

  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [scope, setScope] = useState<ChallengeScope>('personal');
  const [crewId, setCrewId] = useState<string | null>(null);
  const [targetText, setTargetText] = useState('');
  const [durationText, setDurationText] = useState('');
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [exerciseQuery, setExerciseQuery] = useState('');

  const template = templates?.find((entry) => entry.key === templateKey) ?? null;

  // Only crews the member can actually create a challenge in.
  const adminCrews = (crews ?? []).flatMap((entry) =>
    entry.crew && (entry.role === 'owner' || entry.role === 'admin') ? [entry.crew] : [],
  );
  const selectedCrew = adminCrews.find((crew) => crew.id === crewId) ?? null;

  const firstAdminCrewId = adminCrews[0]?.id ?? null;

  const onPickTemplate = (picked: ChallengeTemplate) => {
    setTemplateKey(picked.key);

    // Seed the editable fields from the template so the form opens with a sane,
    // complete configuration rather than blanks.
    const defaults = parseChallengeRule(picked.default_rule);
    setTargetText(String(defaults.target ?? 1));
    setDurationText(String(picked.default_duration_days));

    // A crew-scoped template falls back to personal when the member administers
    // no crew, rather than offering an option the policy would reject.
    const wantsCrew = picked.default_scope === 'crew' && adminCrews.length > 0;
    setScope(wantsCrew ? 'crew' : 'personal');
    setCrewId(wantsCrew ? firstAdminCrewId : null);
    setExerciseId(null);
  };

  const target = Number.parseFloat(targetText);
  const durationDays = Number.parseInt(durationText, 10);
  const needsExercise = template?.rule_type === 'exercise_1rm_gain';

  const timezone = scope === 'crew' ? selectedCrew?.timezone : profile?.timezone;

  const ready =
    template !== null &&
    Number.isFinite(target) &&
    target > 0 &&
    Number.isInteger(durationDays) &&
    durationDays > 0 &&
    (scope === 'personal' || selectedCrew !== null) &&
    (!needsExercise || exerciseId !== null);

  const onCreate = async () => {
    if (!template || !ready) return;

    try {
      const challenge = await create.mutateAsync({
        template,
        scope,
        crewId: scope === 'crew' ? crewId : null,
        timezone: timezone ?? deviceTimezone(),
        target,
        durationDays,
        exerciseId,
      });

      router.replace(`/challenges/${challenge.id}`);
    } catch {
      // Shown through create.isError below. Swallowed here so a rejected
      // mutation does not surface as an unhandled promise rejection.
      return;
    }
  };

  const filteredExercises = (exercises ?? [])
    .filter((exercise) => exercise.is_weighted)
    .filter((exercise) =>
      exerciseQuery.trim().length === 0
        ? true
        : exercise.name.toLowerCase().includes(exerciseQuery.trim().toLowerCase()),
    )
    .slice(0, 12);

  return (
    <Screen title="Start a challenge" subtitle="Pick something you would do anyway.">
      {/* Template picker. */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="heading" heading>
          Choose one
        </Text>

        {loadingTemplates ? (
          <Card>
            <Text variant="caption" tone="muted">
              Loading…
            </Text>
          </Card>
        ) : null}

        {(templates ?? []).map((entry) => {
          const selected = entry.key === templateKey;
          const defaults = parseChallengeRule(entry.default_rule);

          return (
            <Pressable
              key={entry.key}
              onPress={() => onPickTemplate(entry)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${entry.name}. ${entry.description}`}
              style={({ pressed }) => [
                styles.card,
                {
                  padding: theme.spacing.lg,
                  borderRadius: theme.radius.lg,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
                  opacity: pressed ? 0.85 : 1,
                  gap: theme.spacing.xs,
                },
              ]}
            >
              <Text variant="subheading">
                {entry.badge_emoji ? `${entry.badge_emoji} ` : ''}
                {entry.name}
              </Text>
              <Text variant="caption" tone="muted">
                {describeChallengeRule(entry.rule_type, entry.default_rule, defaults.target ?? 1)}
              </Text>
              <Text variant="caption" tone="subtle">
                {entry.default_duration_days} days ·{' '}
                {entry.default_scope === 'crew' ? 'crew' : 'personal'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Configuration, revealed only once a template is chosen. */}
      {template ? (
        <Card>
          <Text variant="subheading" heading>
            Set it up
          </Text>

          {/* Scope. Crew is offered only where the member administers one. */}
          <Text variant="caption" tone="muted">
            Who is it for
          </Text>
          <View style={[styles.chipRow, { gap: theme.spacing.sm }]}>
            <Chip
              label="Just me"
              active={scope === 'personal'}
              onPress={() => {
                setScope('personal');
                setCrewId(null);
              }}
            />
            {adminCrews.length > 0 ? (
              <Chip
                label="My crew"
                active={scope === 'crew'}
                onPress={() => {
                  setScope('crew');
                  setCrewId((current) => current ?? firstAdminCrewId);
                }}
              />
            ) : null}
          </View>

          {adminCrews.length === 0 ? (
            <Text variant="caption" tone="subtle">
              Crew challenges can be created by crew owners and admins. You can still run this one
              for yourself.
            </Text>
          ) : null}

          {scope === 'crew' && adminCrews.length > 1 ? (
            <View style={[styles.chipRow, { gap: theme.spacing.sm }]}>
              {adminCrews.map((crew) => (
                <Chip
                  key={crew.id}
                  label={crew.name}
                  active={crew.id === crewId}
                  onPress={() => setCrewId(crew.id)}
                />
              ))}
            </View>
          ) : null}

          {/* Target and duration. */}
          <View style={[styles.fieldRow, { gap: theme.spacing.md }]}>
            <NumberField
              label={targetLabel(template)}
              value={targetText}
              onChangeText={setTargetText}
            />
            <NumberField
              label="Days to do it in"
              value={durationText}
              onChangeText={setDurationText}
            />
          </View>

          {/* Only the 1RM rule needs an exercise. */}
          {needsExercise ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted">
                Which exercise
              </Text>
              <TextInput
                value={exerciseQuery}
                onChangeText={setExerciseQuery}
                placeholder="Search exercises"
                placeholderTextColor={theme.colors.textSubtle}
                autoCorrect={false}
                accessibilityLabel="Search exercises"
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
              <View style={[styles.chipRow, { gap: theme.spacing.sm }]}>
                {filteredExercises.map((exercise) => (
                  <Chip
                    key={exercise.id}
                    label={exercise.name}
                    active={exercise.id === exerciseId}
                    onPress={() => setExerciseId(exercise.id)}
                  />
                ))}
              </View>
              <Text variant="caption" tone="subtle">
                Progress is measured against your best estimated one-rep max BEFORE the challenge
                starts, so work you have already done does not count toward it.
              </Text>
            </View>
          ) : null}

          {/* What the member is committing to, in words, using their own numbers. */}
          {Number.isFinite(target) && target > 0 ? (
            <Text variant="body">
              {describeChallengeRule(
                template.rule_type,
                template.default_rule,
                target,
                exercises?.find((exercise) => exercise.id === exerciseId)?.name,
              )}
            </Text>
          ) : null}

          <Text variant="caption" tone="subtle">
            Scored in {timezone ?? deviceTimezone()}
            {scope === 'crew' ? " (your crew's timezone)" : ''}. Finished sessions of at least 20
            minutes count, or your crew’s own minimum for a crew challenge.
          </Text>

          <Button
            label="Create challenge"
            size="large"
            fullWidth
            disabled={!ready}
            loading={create.isPending}
            onPress={onCreate}
          />

          {create.isError ? (
            <Text variant="caption" tone="danger">
              {errorMessage(create.error, 'Could not create the challenge. Please try again.')}
            </Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

/** The target means something different per rule type, so the label follows it. */
function targetLabel(template: ChallengeTemplate): string {
  switch (template.rule_type) {
    case 'session_count':
    case 'time_of_day':
      return 'Sessions';
    case 'crew_session_total':
      return 'Sessions, combined';
    case 'distinct_gyms':
      return 'Different gyms';
    case 'weekly_consistency':
      return 'Weeks to sustain';
    case 'exercise_1rm_gain':
      return 'Percent gain';
  }
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={{
        minHeight: theme.minTouchTarget,
        justifyContent: 'center',
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? theme.colors.primarySoft : 'transparent',
      }}
    >
      <Text variant="caption" tone={active ? 'primary' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}

function NumberField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
}) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, gap: theme.spacing.xs }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="number-pad"
        accessibilityLabel={label}
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
    </View>
  );
}

/**
 * Device timezone, used only as a last resort.
 *
 * Wrapped because `Intl` is trimmed on some Hermes builds and a throw here would
 * take the screen down. UTC is a poor default for a time-of-day challenge, which
 * is why the profile and crew values are preferred.
 */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  fieldRow: {
    flexDirection: 'row',
  },
  input: {
    borderWidth: 1,
    fontSize: 15,
  },
});
