import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Sidebar } from '@/components/layout/Sidebar';
import { useTheme } from '@/theme';

/**
 * Main navigation.
 *
 * Two layouts, one set of screens:
 *   * Phone  — bottom tab bar (Today / Crew / Explore / Progress).
 *   * Wide   — sidebar dashboard, tab bar hidden.
 *
 * Wrapping `<Tabs>` in a row keeps a single route tree, so no screen is written
 * twice and deep links behave identically on both.
 *
 * Screen ownership by lane:
 *   Today, Crew, Profile  -> sessions/logging, social, ratings, leaderboard
 *   Explore (map), Progress -> gyms/map and stats lane
 */
export default function TabsLayout() {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.shell,
        {
          flexDirection: theme.isWide ? 'row' : 'column',
          backgroundColor: theme.colors.background,
        },
      ]}
    >
      {theme.isWide ? <Sidebar /> : null}

      <View style={styles.content}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.textSubtle,
            tabBarStyle: theme.isWide
              ? { display: 'none' }
              : {
                  backgroundColor: theme.colors.surface,
                  borderTopColor: theme.colors.border,
                  height: 84,
                  paddingTop: 8,
                  paddingBottom: 24,
                },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
            tabBarItemStyle: { paddingTop: 4 },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Today',
              tabBarIcon: ({ color, focused }) => (
                <Ionicons
                  name={focused ? 'sparkles' : 'sparkles-outline'}
                  size={22}
                  color={color}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="crew"
            options={{
              title: 'Crew',
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? 'people' : 'people-outline'} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="map"
            options={{
              // Labelled "Explore" per the design; the route stays `map` so the
              // gyms/map lane's file path is untouched.
              title: 'Explore',
              tabBarIcon: ({ color, focused }) => (
                <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="progress"
            options={{
              title: 'Progress',
              tabBarIcon: ({ color, focused }) => (
                <Ionicons
                  name={focused ? 'stats-chart' : 'stats-chart-outline'}
                  size={22}
                  color={color}
                />
              ),
            }}
          />
          {/*
            Profile is reachable from the Today header on phones and from the
            sidebar account row on wide screens, matching the reference design's
            four-tab bar. `href: null` keeps the route without a tab button.
          */}
          <Tabs.Screen name="profile" options={{ href: null, title: 'Profile' }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
