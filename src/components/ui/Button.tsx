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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'medium' | 'large';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

/**
 * Primary interactive control.
 *
 * Accessibility and usability decisions:
 *   * Always meets the minimum touch target; `large` is bigger still, for
 *     actions used mid-workout (check in, log set, end session).
 *   * Communicates `disabled` and `busy` to assistive technology rather than
 *     only visually.
 *   * While loading, keeps the label mounted so the button cannot change width
 *     and shift surrounding layout.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'medium',
  loading = false,
  fullWidth = false,
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
  };

  const foreground: Record<ButtonVariant, string> = {
    primary: theme.colors.textOnPrimary,
    secondary: theme.colors.primary,
    ghost: theme.colors.primary,
    danger: theme.colors.textOnPrimary,
  };

  const minHeight = size === 'large' ? 56 : theme.minTouchTarget;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight,
          paddingHorizontal: size === 'large' ? theme.spacing.xl : theme.spacing.lg,
          borderRadius: theme.radius.md,
          backgroundColor: background[variant],
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: theme.colors.border,
          // Opacity communicates press and disabled state without changing
          // layout or colour contrast of the label.
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
      {...rest}
    >
      <View style={styles.content}>
        <Text
          variant={size === 'large' ? 'subheading' : 'body'}
          style={[styles.label, { color: foreground[variant] }]}
        >
          {label}
        </Text>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={foreground[variant]}
            style={styles.spinner}
            // The label plus accessibilityState={{busy}} already convey this to
            // screen readers, so hide the redundant spinner from them.
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
  spinner: {
    marginLeft: 8,
  },
});
