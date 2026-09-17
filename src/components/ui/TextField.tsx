import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Explains the field where the label alone is not enough. */
  hint?: string;
  /** Validation or save failure, announced to assistive technology. */
  error?: string | null;
  /** Hides the visible label, keeping it as the accessible name. */
  labelHidden?: boolean;
  /** Grows the input for paragraph entry. */
  multiline?: boolean;
  /** Right-aligned unit or suffix, e.g. "lb". */
  suffix?: string;
}

/**
 * Labelled text input.
 *
 * Exists because eight screens had each rebuilt the same input from scratch, with
 * eight slightly different borders — and, more importantly, three of them forgot
 * `placeholderTextColor`, which on the dark theme renders placeholder text at
 * roughly 1.3:1 against the field. Centralising it means a new form cannot
 * reintroduce that, and the accessible name is always tied to the visible label.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, labelHidden = false, multiline = false, suffix, ...rest },
  ref,
) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.xs, flex: multiline ? undefined : 1 }}>
      {!labelHidden ? (
        <Text variant="caption" tone="muted">
          {label}
        </Text>
      ) : null}

      <View
        style={[
          styles.field,
          {
            minHeight: multiline ? 88 : theme.minTouchTarget,
            borderRadius: theme.radius.md,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surfaceMuted,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.sm,
          },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          multiline={multiline}
          placeholderTextColor={theme.colors.textSubtle}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              paddingVertical: multiline ? theme.spacing.md : 0,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
          {...rest}
        />

        {suffix ? (
          <Text variant="caption" tone="subtle">
            {suffix}
          </Text>
        ) : null}
      </View>

      {hint && !error ? (
        <Text variant="caption" tone="subtle">
          {hint}
        </Text>
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
});
