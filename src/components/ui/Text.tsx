import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme';

export type TextVariant = 'title' | 'heading' | 'subheading' | 'body' | 'caption' | 'metric';
export type TextTone = 'default' | 'muted' | 'subtle' | 'primary' | 'accent' | 'success' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Renders as an accessibility header, for screen-reader navigation. */
  heading?: boolean;
}

/**
 * Themed text primitive.
 *
 * Using this instead of react-native's `Text` guarantees tokenised sizing and
 * colour, so contrast and rhythm stay consistent and dark mode works
 * everywhere.
 */
export function Text({
  variant = 'body',
  tone = 'default',
  heading = false,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();

  const toneColor: Record<TextTone, string> = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    subtle: theme.colors.textSubtle,
    primary: theme.colors.primary,
    accent: theme.colors.accent,
    success: theme.colors.success,
    danger: theme.colors.danger,
  };

  return (
    <RNText
      accessibilityRole={heading ? 'header' : undefined}
      style={[theme.typography[variant] as TextStyle, { color: toneColor[tone] }, style]}
      {...rest}
    />
  );
}
