import { Pressable, StyleSheet, View } from 'react-native';

import {
  useChallengeTemplates,
  useMyChallenges,
  type Challenge,
  type ChallengeTemplate,
} from '@/api';
import { Button, Card, ProgressBar, SectionHeader, Text } from '@/components/ui';
import {
  challengeStatus,
  daysRemaining,
  formatChallengeProgress,
  isCombinedProgress,
} from '@/lib/challengeRules';
import { useTheme } from '@/theme';

/**
 * The personal challenges highlighted when a member has room for more.
 *
 * These are KEYS into `challenge_templates`, not challenge definitions: the name,
 * description, and badge all come from the row. Scoring still lives entirely in
 * `score_challenge_for_user()`, so this list changes which of the seeded
 * templates get a shortcut, and nothing about how any of them are judged. A key
 * that is not in the catalogue is simply skipped.
 */
const HIGHLIGHTED_TEMPLATE_KEYS = ['early_bird_5', 'consistency_3x4', 'exploration_3_gyms'];

export interface ActiveChallengesProps {
  /** How many joined challenges to show before deferring to the full list. */
  limit?: number;
  /**
   * Whether to fill the remaining space with templates the member has not joined.
   * Keeps the card useful on a dashboard, where an empty panel reads as broken.
   */
  showSuggestions?: boolean;
  onOpenChallenge?: (challengeId: string) => void;
  onSeeAll?: () => void;
  /** Opens the create-a-challenge flow. Suggestions are inert without it. */
  onStartChallenge?: () => void;
}

/**
 * Compact list of the challenges a member is currently in, plus what they could
 * join next.
 *
 * Built as a self-contained card so it can be dropped into any screen with one
 * line and no prop plumbing:
 *
 *   <ActiveChallenges onSeeAll={() => router.push('/challenges')} />
 *
 * WHY SUGGESTIONS ARE PART OF THE SAME CARD
 * -----------------------------------------
 * Participation is opt-in, so a member who has joined nothing is the normal case,
 * not an error. A card that renders only a sentence explaining its own emptiness
 * is indistinguishable from a broken one on a dashboard. Showing the real
 * catalogue keeps the section substantive on first load without interaction, and
 * without inventing challenges that do not exist: every row below is a
 * `challenge_templates` row.
 *
 * Crew-scoped templates are excluded because creating one is admin-only
 * (`challenges_insert_crew_admin`), and offering an action the policy will reject
 * is worse than not offering it.
 */
export function ActiveChallenges({
  limit = 3,
  showSuggestions = true,
  onOpenChallenge,
  onSeeAll,
  onStartChallenge,
}: ActiveChallengesProps) {
  const theme = useTheme();
  const { data: mine, isLoading } = useMyChallenges();
  const { data: templates } = useChallengeTemplates();

  // flatMap rather than filter so the non-null challenge is carried in the type
  // instead of being asserted at every use.
  const active = (mine ?? [])
    .flatMap((entry) =>
      entry.challenge ? [{ challenge: entry.challenge, participation: entry }] : [],
    )
    .filter(({ challenge }) => challengeStatus(challenge.starts_at, challenge.ends_at) !== 'ended')
    // Soonest deadline first: that is the one worth acting on today.
    .sort((a, b) => Date.parse(a.challenge.ends_at) - Date.parse(b.challenge.ends_at));

  const shown = active.slice(0, limit);

  const suggestions = showSuggestions ? suggestTemplates(templates, active) : [];

  return (
    <Card>
      <SectionHeader
        title="Challenges"
        actionLabel={onSeeAll ? seeAllLabel(active.length, shown.length) : undefined}
        onAction={onSeeAll}
      />

      {isLoading ? (
        <Text variant="caption" tone="muted">
          Loading…
        </Text>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {shown.map(({ challenge, participation }) => (
            <ChallengeRow
              key={challenge.id}
              challenge={challenge}
              progress={Number(participation.progress)}
              completed={participation.completed_at !== null}
              onPress={onOpenChallenge}
            />
          ))}

          {suggestions.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="eyebrow" tone="muted">
                {shown.length > 0 ? 'Join next' : 'Ready when you are'}
              </Text>

              {suggestions.map((template) => (
                <SuggestionRow key={template.key} template={template} onPress={onStartChallenge} />
              ))}
            </View>
          ) : null}

          {shown.length === 0 && suggestions.length === 0 ? (
            <Text variant="caption" tone="muted">
              You are not in a challenge right now. They are a nudge, not an obligation.
            </Text>
          ) : null}

          {onStartChallenge ? (
            <Button label="Start a challenge" variant="secondary" onPress={onStartChallenge} />
          ) : onSeeAll ? (
            <Button label="Browse challenges" variant="secondary" onPress={onSeeAll} />
          ) : null}
        </View>
      )}
    </Card>
  );
}

/**
 * Personal templates the member is not already running, highlighted ones first.
 *
 * Ordered by `HIGHLIGHTED_TEMPLATE_KEYS` rather than alphabetically so the panel
 * is stable across reloads and shows the same three every time.
 */
function suggestTemplates(
  templates: ChallengeTemplate[] | undefined,
  active: { challenge: Challenge }[],
): ChallengeTemplate[] {
  if (!templates) return [];

  const joinedKeys = new Set(
    active.flatMap(({ challenge }) => (challenge.template_key ? [challenge.template_key] : [])),
  );

  const available = templates.filter(
    (template) => template.default_scope === 'personal' && !joinedKeys.has(template.key),
  );

  const rank = (template: ChallengeTemplate) => {
    const index = HIGHLIGHTED_TEMPLATE_KEYS.indexOf(template.key);
    return index === -1 ? HIGHLIGHTED_TEMPLATE_KEYS.length : index;
  };

  return available
    .filter((template) => HIGHLIGHTED_TEMPLATE_KEYS.includes(template.key))
    .sort((a, b) => rank(a) - rank(b));
}

function seeAllLabel(total: number, shown: number): string {
  return total > shown ? `See all ${total}` : 'All';
}

/**
 * A joinable template.
 *
 * Deliberately has no progress bar: the member has no progress in something they
 * have not joined, and a zeroed bar would imply they were already enrolled and
 * failing at it.
 */
function SuggestionRow({
  template,
  onPress,
}: {
  template: ChallengeTemplate;
  onPress?: () => void;
}) {
  const theme = useTheme();

  const content = (
    <View
      style={[
        styles.suggestion,
        {
          gap: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surfaceMuted,
        },
      ]}
    >
      {template.badge_emoji ? (
        <Text variant="body" accessibilityElementsHidden importantForAccessibility="no">
          {template.badge_emoji}
        </Text>
      ) : null}

      <View style={styles.suggestionText}>
        <Text variant="body" numberOfLines={1}>
          {template.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {template.description}
        </Text>
      </View>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Start ${template.name}. ${template.description}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

function ChallengeRow({
  challenge,
  progress,
  completed,
  onPress,
}: {
  challenge: Challenge;
  progress: number;
  completed: boolean;
  onPress?: (challengeId: string) => void;
}) {
  const theme = useTheme();

  const target = Number(challenge.target);
  const label = formatChallengeProgress(challenge.rule_type, progress, target);
  const days = daysRemaining(challenge.ends_at);
  const timing = completed ? 'Complete' : days <= 0 ? 'Ends today' : `${days}d left`;

  const content = (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={[styles.titleRow, { gap: theme.spacing.sm }]}>
        <Text variant="body" numberOfLines={1} style={styles.title}>
          {challenge.badge_emoji ? `${challenge.badge_emoji} ` : ''}
          {challenge.name}
        </Text>
        <Text variant="caption" tone={completed ? 'success' : 'subtle'}>
          {timing}
        </Text>
      </View>

      <ProgressBar
        label={isCombinedProgress(challenge.rule_type) ? 'Crew combined' : 'Your progress'}
        value={progress}
        target={target}
        showCounts={false}
      />

      <Text variant="caption" tone={completed ? 'success' : 'muted'}>
        {label}
      </Text>
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={() => onPress(challenge.id)}
      accessibilityRole="button"
      accessibilityLabel={`${challenge.name}, ${label}, ${timing}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  suggestionText: {
    flex: 1,
  },
});
