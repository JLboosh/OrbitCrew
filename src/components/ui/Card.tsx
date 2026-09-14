import { StyleSheet, View, type ViewProps } from 'react-native';

import { useTheme } from '@/theme';

export interface CardProps extends ViewProps {
  /** Removes internal padding when the card hosts its own rows. */
  flush?: boolean;
}

/** Raised surface used to group related content. */
export function Card({ flush = false, style, ...rest }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.lg,
          padding: flush ? 0 : theme.spacing.lg,
          gap: flush ? 0 : theme.spacing.sm,
        },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
