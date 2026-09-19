import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';

import { BRANDING } from '@/constants/branding';
import { avatarColor, readableTextOn, useTheme } from '@/theme';

/**
 * The wordmark.
 *
 * Reads the product name from `branding.json` and applies the design's
 * treatment — wide-tracked capitals with a coloured `//` terminator — so a
 * rebrand still only touches one file.
 */
export function Wordmark({ size = 18 }: { size?: number }) {
  const theme = useTheme();

  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel={BRANDING.displayName}>
      <Text
        style={{
          fontSize: size,
          lineHeight: size * 1.2,
          fontWeight: '600',
          letterSpacing: size * 0.12,
          color: theme.colors.text,
        }}
      >
        {BRANDING.displayName.toUpperCase()}
      </Text>
      <Text
        style={{
          fontSize: size,
          lineHeight: size * 1.2,
          fontWeight: '600',
          letterSpacing: size * 0.06,
          color: theme.colors.primary,
        }}
      >
        {/* Braced string: bare `//` in JSX children is parsed as a comment. */}
        {'//'}
      </Text>
    </View>
  );
}

export interface AvatarProps {
  /** Stable id, used to pick a consistent colour. */
  id: string;
  name: string;
  size?: number;
  /** Overlaps the previous avatar, for stacks. */
  overlap?: boolean;
  /**
   * Uploaded profile picture, when the member has one.
   *
   * Optional on purpose: most avatars in the app are drawn from data that carries
   * no picture (crew names, leaderboard rows), and passing nothing keeps the
   * initial-based behaviour those surfaces have always had.
   */
  imageUrl?: string | null;
}

/**
 * Avatar: an uploaded picture when there is one, otherwise the member's initial.
 *
 * The coloured initial is not a placeholder waiting to be replaced — it is the
 * real avatar for everyone who has not uploaded a picture, which is most people.
 * Derived from the id, so it is stable across devices and keeps a stack readable.
 *
 * When there IS a picture, the initial stays rendered underneath it rather than
 * being swapped out on load, so a slow or broken image shows the member's colour
 * and letter instead of an empty hole.
 */
export function Avatar({ id, name, size = 32, overlap = false, imageUrl }: AvatarProps) {
  const theme = useTheme();
  const background = avatarColor(id, theme.colors.avatarPalette);
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: overlap ? -size * 0.28 : 0,
        borderWidth: 2,
        borderColor: theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      {/* Foreground derived from the background rather than fixed white: the
          dark palette includes a near-white entry, on which white initials
          disappear entirely. */}
      <Text
        style={{
          fontSize: size * 0.42,
          lineHeight: size * 0.52,
          fontWeight: '600',
          color: readableTextOn(background),
        }}
      >
        {initial}
      </Text>

      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          // Decorative: the wrapper already carries the member's name as its
          // accessibility label, so announcing the image would say it twice.
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
      ) : null}
    </View>
  );
}

/** Overlapping avatar row with an optional "+N" overflow chip. */
export function AvatarStack({
  members,
  max = 4,
  size = 32,
}: {
  members: { id: string; name: string }[];
  max?: number;
  size?: number;
}) {
  const theme = useTheme();
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${members.length} member${members.length === 1 ? '' : 's'}`}
    >
      {shown.map((member, index) => (
        <Avatar key={member.id} id={member.id} name={member.name} size={size} overlap={index > 0} />
      ))}
      {overflow > 0 ? (
        <View
          style={{
            height: size,
            paddingHorizontal: theme.spacing.sm,
            borderRadius: size / 2,
            backgroundColor: theme.colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -size * 0.28,
            borderWidth: 2,
            borderColor: theme.colors.surface,
          }}
        >
          <Text variant="caption" tone="muted">
            +{overflow}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Small status pill.
 *
 * `live` renders a coral dot — used for presence and "training now". Coral is an
 * attention colour here, never a warning.
 */
export function Badge({
  label,
  tone = 'neutral',
  live = false,
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'primary' | 'success';
  live?: boolean;
}) {
  const theme = useTheme();

  const background: Record<string, string> = {
    neutral: theme.colors.surfaceMuted,
    accent: theme.colors.accentSoft,
    primary: theme.colors.primarySoft,
    success: theme.colors.successSoft,
  };
  const foreground: Record<string, string> = {
    neutral: theme.colors.textMuted,
    accent: theme.colors.accent,
    primary: theme.colors.primary,
    success: theme.colors.success,
  };

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: background[tone],
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.spacing.sm + 2,
          paddingVertical: 5,
          gap: 6,
        },
      ]}
    >
      {live ? (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: theme.colors.accent,
          }}
        />
      ) : null}
      <Text variant="caption" style={{ color: foreground[tone], fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

/** Circular icon button, as used for the header action in the design. */
export function IconButton({
  icon,
  label,
  onPress,
  size = 42,
  variant = 'surface',
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  size?: number;
  variant?: 'surface' | 'primary';
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isPrimary ? theme.colors.primary : theme.colors.surface,
          borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.75 : 1,
        },
        theme.shadow.card,
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={size * 0.45}
        color={isPrimary ? theme.colors.textOnPrimary : theme.colors.text}
      />
    </Pressable>
  );
}

/** Section header with an optional right-hand action link. */
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.between, { marginBottom: theme.spacing.sm }]}>
      <Text variant="heading" heading>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
        >
          <Text variant="caption" tone="primary" style={{ fontWeight: '600' }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
