import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Rendered as the screen's accessibility header. */
  title?: string;
  /** Supporting line beneath the title. */
  subtitle?: string;
  /** Set false for screens that manage their own scrolling (maps, lists). */
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

/**
 * Standard screen wrapper: safe-area insets, background colour, consistent
 * padding, and an optional accessible title.
 *
 * Centralising this means a new screen cannot accidentally render content under
 * the notch or the home indicator.
 */
export function Screen({ children, title, subtitle, scroll = true, contentStyle }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const header =
    title || subtitle ? (
      <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.lg }}>
        {title ? (
          <Text variant="title" heading>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="body" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    ) : null;

  const padding: ViewStyle = {
    paddingTop: insets.top + theme.spacing.lg,
    paddingBottom: insets.bottom + theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
  };

  if (!scroll) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.fill, padding, contentStyle]}>
          {header}
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={[padding, { gap: theme.spacing.lg }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
