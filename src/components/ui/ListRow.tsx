import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { useTheme } from '@/theme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Right-aligned value, e.g. "3 / 5" or a session count. */
  value?: string;
  /** Circular leading icon, as used by the challenge rows in the design. */
  icon?: keyof typeof Ionicons.glyphMap;
  iconTone?: 'primary' | 'accent';
  /** Leading element instead of an icon, e.g. an Avatar or a rank number. */
  leading?: React.ReactNode;
  onPress?: () => void;
  /** Hairline separator beneath the row. */
  divider?: boolean;
  valueTone?: 'primary' | 'muted' | 'default';
}

/**
 * Generic row used by challenge lists, leaderboards, and activity feeds.
 *
 * One component rather than three near-identical ones, so spacing and the
 * accessibility summary stay consistent everywhere.
 */
export function ListRow({
  title,
  subtitle,
  value,
  icon,
  iconTone = 'primary',
  leading,
  onPress,
  divider = false,
  valueTone = 'primary',
}: ListRowProps) {
  const theme = useTheme();

  const iconBackground = iconTone === 'accent' ? theme.colors.accentSoft : theme.colors.primarySoft;
  const iconColor = iconTone === 'accent' ? theme.colors.accent : theme.colors.primary;

  const body = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          gap: theme.spacing.md,
          minHeight: theme.minTouchTarget,
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.border,
        },
      ]}
    >
      {leading ?? null}

      {!leading && icon ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: iconBackground,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={19} color={iconColor} />
        </View>
      ) : null}

      <View style={styles.copy}>
        <Text variant="subheading">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text
          variant="subheading"
          tone={valueTone === 'primary' ? 'primary' : valueTone === 'muted' ? 'muted' : 'default'}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );

  // A single accessible summary, so a screen reader announces the row once
  // rather than reading three disconnected fragments.
  const accessibilityLabel = [title, subtitle, value].filter(Boolean).join(', ');

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * Simple bar chart for weekly volume or session counts.
 *
 * The most recent bar is emphasised, matching the "Your momentum" card. Pure
 * views rather than a charting dependency: this is a sparkline, not analytics.
 */
export function MiniBars({
  values,
  label,
  height = 92,
}: {
  values: number[];
  label: string;
  height?: number;
}) {
  const theme = useTheme();
  const max = Math.max(...values, 1);

  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${values.length} periods, most recent ${values[values.length - 1] ?? 0}.`}
      style={[styles.bars, { height, gap: theme.spacing.sm }]}
    >
      {values.map((value, index) => {
        const isLast = index === values.length - 1;
        // Minimum 6% so an empty period still shows a visible stub rather than
        // silently disappearing.
        const ratio = Math.max(value / max, 0.06);
        return (
          <View
            key={index}
            style={{
              flex: 1,
              height: `${ratio * 100}%`,
              backgroundColor: isLast ? theme.colors.primary : theme.colors.primarySoft,
              borderTopLeftRadius: theme.radius.sm,
              borderTopRightRadius: theme.radius.sm,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
