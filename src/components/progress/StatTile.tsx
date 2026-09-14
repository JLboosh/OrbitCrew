import { View } from 'react-native';

import { Text, type TextTone } from '@/components/ui';
import { useTheme } from '@/theme';

export interface StatTileProps {
  label: string;
  /** The headline figure, already formatted. */
  value: string;
  /**
   * The measurement behind the figure, e.g. "12 of the last 12 weeks".
   * Strongly encouraged: a number with no context is the thing this product
   * explicitly avoids.
   */
  caption?: string;
  tone?: TextTone;
}

/**
 * A single headline statistic.
 *
 * The caption is what keeps this honest. "+140%" alone is the kind of figure the
 * product rules forbid; "+140% · 5 → 12 sessions a month" is a claim a member can
 * check.
 */
export function StatTile({ label, value, caption, tone = 'default' }: StatTileProps) {
  const theme = useTheme();

  const accessibilityLabel = [label, value, caption].filter(Boolean).join(', ');

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexGrow: 1,
        flexBasis: '45%',
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="heading" tone={tone}>
        {value}
      </Text>
      {caption ? (
        <Text variant="caption" tone="subtle">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
