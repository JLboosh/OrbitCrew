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
  /** Wide-tracked uppercase line above the title, e.g. a date. */
  eyebrow?: string;
  /** Custom row rendered above everything, e.g. a wordmark and action button. */
  header?: ReactNode;
  /** Set false for screens that manage their own scrolling. */
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

/**
 * Standard screen wrapper: safe-area insets, canvas colour, consistent padding,
 * and an optional accessible title.
 *
 * Centralising this means a new screen cannot accidentally render content under
 * the notch or the home indicator. On a wide viewport it also caps and centres
 * content so the dashboard does not sprawl across a large monitor.
 */
export function Screen({
  children,
  title,
  subtitle,
  eyebrow,
  header,
  scroll = true,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const heading =
    title || subtitle || eyebrow ? (
      <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.md }}>
        {eyebrow ? (
          <Text variant="eyebrow" tone="muted">
            {eyebrow}
          </Text>
        ) : null}
        {title ? (
          <Text variant="display" heading>
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
    // On wide layouts the sidebar supplies the top offset, so the notch inset is
    // only needed on phones.
    paddingTop: theme.isWide ? theme.spacing.xl : insets.top + theme.spacing.md,
    paddingBottom: insets.bottom + theme.spacing.xxl,
    paddingHorizontal: theme.isWide ? theme.spacing.xxl : theme.spacing.lg,
  };

  const inner = (
    <View
      style={{
        width: '100%',
        maxWidth: theme.isWide ? theme.maxContentWidth : undefined,
        alignSelf: 'center',
        gap: theme.spacing.lg,
      }}
    >
      {header}
      {heading}
      {children}
    </View>
  );

  if (!scroll) {
    return (
      <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.fill, padding, contentStyle]}>{inner}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {inner}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
