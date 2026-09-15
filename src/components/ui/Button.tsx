import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Right-aligned trailing text, e.g. a timer inside the session pill. */
  trailing?: string;
  style?: ViewStyle;
}

/**
 * Primary interactive control.
 *
 * Accessibility and usability decisions:
 *   * Always meets the minimum touch target; `large` is taller still, for
 *     actions used mid-workout (start, log set, end session).
 *   * Communicates `disabled` and `busy` to assistive technology, not just
 *     visually.
 *   * The label stays mounted while loading, so the button cannot change width
 *     and shift surrounding layout.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'medium',
  loading = false,
  fullWidth = false,
  icon,
  trailing,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = Boolean(disabled) || loading;

  const background: Record<ButtonVariant, string> = {
    primary: theme.colors.primary,
    secondary: theme.colors.primarySoft,
    ghost: 'transparent',
    danger: theme.colors.danger,
    quiet: theme.colors.surfaceMuted,
  };

  const foreground: Record<ButtonVariant, string> = {
    primary: theme.colors.textOnPrimary,
    secondary: theme.colors.primary,
    ghost: theme.colors.primary,
    danger: theme.colors.textOnPrimary,
    quiet: theme.colors.text,
  };

  const minHeight = size === 'large' ? 54 : size === 'small' ? 36 : theme.minTouchTarget;
  const horizontal =
    size === 'large' ? theme.spacing.xl : size === 'small' ? theme.spacing.md : theme.spacing.lg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight,
          paddingHorizontal: horizontal,
          // Pill radius matches the design's fully rounded buttons.
          borderRadius: theme.radius.pill,
          backgroundColor: background[variant],
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.colors.border,
          opacity: isDisabled ? 0.45 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          justifyContent: trailing ? 'space-between' : 'center',
        },
        style,
      ]}
      {...rest}
    >
      <View style={[styles.content, { gap: theme.spacing.sm }]}>
        {icon ? (
          <Ionicons name={icon} size={size === 'small' ? 15 : 18} color={foreground[variant]} />
        ) : null}
        <Text
          variant={size === 'large' ? 'subheading' : size === 'small' ? 'caption' : 'body'}
          style={[styles.label, { color: foreground[variant] }]}
        >
          {label}
        </Text>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={foreground[variant]}
            // The label plus accessibilityState={{busy}} already convey this, so
            // the redundant spinner is hidden from assistive tech.
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>

      {trailing ? (
        <Text variant="mono" style={{ color: foreground[variant] }}>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
