import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/theme';

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'caption'
  | 'eyebrow'
  | 'metric'
  | 'mono';

export type TextTone =
  'default' | 'muted' | 'subtle' | 'primary' | 'accent' | 'success' | 'danger' | 'onPrimary';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Renders as an accessibility header for screen-reader navigation. */
  heading?: boolean;
}

/**
 * Themed text primitive.
 *
 * `eyebrow` auto-uppercases, since the design uses wide-tracked capitals for
 * dates and section labels and doing it here keeps call sites readable
 * (and keeps the original string available to screen readers).
 */
export function Text({
  variant = 'body',
  tone = 'default',
  heading = false,
  style,
  children,
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
    onPrimary: theme.colors.textOnPrimary,
  };

  return (
    <RNText
      accessibilityRole={heading ? 'header' : undefined}
      style={[
        theme.typography[variant] as TextStyle,
        { color: toneColor[tone] },
        variant === 'eyebrow' ? { textTransform: 'uppercase' } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
