import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface SettingSwitchProps {
  label: string;
  /**
   * Explains the consequence of enabling this in plain language. Required, not
   * optional: a privacy control the user does not understand is not meaningful
   * consent.
   */
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}

/**
 * Labelled switch row used throughout the Profile/Privacy screen.
 *
 * THE WHOLE ROW IS THE CONTROL, not just the switch. Two reasons:
 *
 *   1. Accessibility. The row is a single element announcing the label, its
 *      consequence, and its state, so a screen-reader user hears everything
 *      before acting — and activating it actually toggles the setting. An
 *      earlier version exposed the row as a switch but left only the inner
 *      Switch interactive, so activating it did nothing.
 *
 *   2. Touch area. A ~50x30pt switch is a small target for a one-handed tap;
 *      the full row is far easier to hit.
 */
export function SettingSwitch({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: SettingSwitchProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.lg,
          minHeight: theme.minTouchTarget,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.copy}>
        <Text variant="subheading">{label}</Text>
        <Text variant="caption" tone="muted">
          {description}
        </Text>
      </View>

      {/*
        Visual indicator only. The parent Pressable owns both the interaction
        and the accessibility contract, so this is hidden from assistive tech
        and does not receive touches of its own.
      */}
      <View pointerEvents="none">
        <Switch
          value={value}
          disabled={disabled}
          trackColor={{ false: theme.colors.track, true: theme.colors.primary }}
          thumbColor={theme.colors.surface}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
