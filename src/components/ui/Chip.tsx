import { Pressable } from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  /**
   * `radio` for a one-of-many choice, `checkbox` for an independent toggle.
   *
   * Not cosmetic: a screen reader announces "selected" for a radio and
   * "checked"/"not checked" for a checkbox, and picking the wrong one tells a
   * member that a multi-select is single-select.
   */
  role?: 'radio' | 'checkbox';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
}

/** Pill-shaped selectable filter, used for scopes, radii, and muscle groups. */
export function Chip({
  label,
  active,
  onPress,
  role = 'radio',
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: ChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={
        role === 'checkbox' ? { checked: active, disabled } : { selected: active, disabled }
      }
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({
        minHeight: theme.minTouchTarget,
        justifyContent: 'center',
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: active ? theme.colors.primary : theme.colors.border,
        backgroundColor: active ? theme.colors.primarySoft : 'transparent',
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text variant="caption" tone={active ? 'primary' : 'muted'}>
        {label}
      </Text>
    </Pressable>
  );
}
