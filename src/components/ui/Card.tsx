import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme';

export interface CardProps extends ViewProps {
  /** Removes internal padding when the card hosts its own rows. */
  flush?: boolean;
  /**
   * `plain`   — white surface, the default.
   * `feature` — tinted sage panel used for the crew goal / greeting hero.
   * `outline` — no shadow, hairline border only.
   */
  variant?: 'plain' | 'feature' | 'outline';
}

/**
 * Raised surface.
 *
 * The design distinguishes surfaces mainly through the off-white canvas versus
 * white cards, so the shadow is intentionally subtle. `feature` swaps in the
 * tinted panel used for the hero and crew-goal cards.
 */
export function Card({ flush = false, variant = 'plain', style, ...rest }: CardProps) {
  const theme = useTheme();

  const background = variant === 'feature' ? theme.colors.gradientStart : theme.colors.surface;

  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: theme.radius.xl,
          padding: flush ? 0 : theme.spacing.lg,
          gap: flush ? 0 : theme.spacing.sm,
        },
        variant === 'outline'
          ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border }
          : theme.shadow.card,
        style,
      ]}
      {...rest}
    />
  );
}
