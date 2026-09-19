import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useMyCrews, useMyProfile } from '@/api';
import { Avatar, Text, Wordmark } from '@/components/ui';
import { useTheme } from '@/theme';

interface NavItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: '/(tabs)' | '/(tabs)/crew' | '/(tabs)/friends' | '/(tabs)/progress' | '/(tabs)/map';
  /** Path fragment used to decide the active state. */
  match: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', icon: 'sparkles-outline', route: '/(tabs)', match: 'index' },
  { label: 'Crew', icon: 'people-outline', route: '/(tabs)/crew', match: 'crew' },
  { label: 'Friends', icon: 'person-add-outline', route: '/(tabs)/friends', match: 'friends' },
  { label: 'Progress', icon: 'stats-chart-outline', route: '/(tabs)/progress', match: 'progress' },
  { label: 'Explore gyms', icon: 'location-outline', route: '/(tabs)/map', match: 'map' },
];

/**
 * Sidebar navigation for the wide/desktop layout.
 *
 * Only rendered when `theme.isWide` is true. On phones the bottom tab bar is the
 * navigation, so this is never mounted there.
 *
 * Routes intentionally reuse the same tab screens rather than duplicating them:
 * one set of screens serves both layouts, so a feature never has to be built
 * twice.
 */
export function Sidebar() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const { data: profile } = useMyProfile();
  const { data: memberships } = useMyCrews();
  const crew = memberships?.[0]?.crew ?? null;
  const memberCount = memberships?.length ?? 0;

  function isActive(item: NavItem): boolean {
    if (item.match === 'index') {
      // The Overview route is the tab group root, so the pathname is "/" or empty.
      return pathname === '/' || pathname === '' || pathname === '/index';
    }
    return pathname.includes(item.match);
  }

  return (
    <View
      style={[
        styles.sidebar,
        {
          backgroundColor: theme.colors.surfaceMuted,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: theme.colors.border,
          paddingVertical: theme.spacing.xl,
          paddingHorizontal: theme.spacing.lg,
        },
      ]}
    >
      <View style={{ paddingHorizontal: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
        <Wordmark size={20} />
      </View>

      {/* Crew switcher. */}
      {crew ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Current crew ${crew.name}. Switch crew.`}
          onPress={() => router.push('/(tabs)/crew')}
          style={({ pressed }) => [
            styles.crewCard,
            theme.shadow.card,
            {
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.md,
              gap: theme.spacing.md,
              marginBottom: theme.spacing.xl,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Avatar id={crew.id} name={crew.name} size={36} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={2}>
              {crew.name}
            </Text>
            <Text variant="caption" tone="muted">
              {memberCount === 1 ? '1 crew' : `${memberCount} crews`}
            </Text>
          </View>
          <Ionicons name="chevron-expand" size={16} color={theme.colors.textSubtle} />
        </Pressable>
      ) : null}

      <Text
        variant="eyebrow"
        tone="subtle"
        style={{ paddingHorizontal: theme.spacing.sm, marginBottom: theme.spacing.sm }}
      >
        Command center
      </Text>

      <ScrollView style={styles.nav} showsVerticalScrollIndicator={false}>
        <View style={{ gap: theme.spacing.xs }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item);
            return (
              <Pressable
                key={item.label}
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                onPress={() => router.push(item.route)}
                style={({ pressed }) => [
                  styles.navItem,
                  {
                    borderRadius: theme.radius.md,
                    paddingVertical: theme.spacing.md,
                    paddingHorizontal: theme.spacing.md,
                    gap: theme.spacing.md,
                    minHeight: theme.minTouchTarget,
                    backgroundColor: active ? theme.colors.surface : 'transparent',
                    opacity: pressed ? 0.75 : 1,
                  },
                  active ? theme.shadow.card : null,
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={19}
                  color={active ? theme.colors.primary : theme.colors.textMuted}
                />
                <Text
                  variant="subheading"
                  tone={active ? 'default' : 'muted'}
                  style={{ fontWeight: active ? '600' : '500' }}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Account row, pinned to the bottom like the reference layout. */}
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Your profile and privacy settings"
        onPress={() => router.push('/(tabs)/profile')}
        style={({ pressed }) => [
          styles.account,
          {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            paddingTop: theme.spacing.lg,
            gap: theme.spacing.md,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        {profile ? (
          <Avatar
            id={profile.id}
            name={profile.display_name}
            imageUrl={profile.avatar_url}
            size={36}
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {profile?.display_name ?? '—'}
          </Text>
          <Text variant="caption" tone="muted">
            Profile and privacy
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 268,
    flexShrink: 0,
  },
  crewCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nav: {
    flex: 1,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
