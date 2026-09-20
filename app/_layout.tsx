import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { ConfirmProvider } from '@/components/ui';
import { queryClient } from '@/lib/queryClient';
import { registerServiceWorker } from '@/lib/registerServiceWorker';
import { ThemeProvider, useTheme } from '@/theme';

/**
 * Redirects between the authenticated app and the sign-in flow.
 *
 * Waits for `initialising` to finish: the persisted session is read
 * asynchronously from storage, and routing before it resolves would flash the
 * sign-in screen at members who are already signed in.
 */
function useProtectedRoute() {
  const { session, initialising } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initialising) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, initialising, segments, router]);
}

function RootNavigator() {
  const { initialising, session } = useAuth();
  const segments = useSegments();
  const theme = useTheme();
  useProtectedRoute();

  /**
   * Signed out, but still standing on a signed-in screen.
   *
   * `useProtectedRoute` redirects from an EFFECT, which runs after render — so on
   * sign-out there is at least one frame where the tab screens are still mounted
   * with no session and, by then, an already-cleared query cache. Every screen
   * that distinguishes "no data" from "loading" renders its failure state into
   * that frame, which is what produced the message that flashed past too quickly
   * to read after confirming sign out. (It was the daily challenge card's
   * "Today's challenge did not load".)
   *
   * Holding the neutral indicator for that frame fixes the whole class of it at
   * once, rather than teaching a dozen screens to special-case being signed out.
   */
  const signedOutOnPrivateScreen = !initialising && !session && segments[0] !== '(auth)';

  if (initialising || signedOutOnPrivateScreen) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      {/*
        Workout flow: choose type -> track -> (history detail).
        `session/new` and `session/active` are static segments, so they take
        precedence over `session/[id]` and the dynamic route never swallows them.
      */}
      <Stack.Screen
        name="session/new"
        options={{ headerShown: true, title: 'Start workout', presentation: 'modal' }}
      />
      <Stack.Screen
        name="session/active"
        options={{
          headerShown: true,
          title: 'Workout',
          // Presented as a sheet: logging happens on top of whatever the member
          // was doing, and dismissing must not lose the session.
          presentation: 'modal',
        }}
      />
      <Stack.Screen name="session/[id]" options={{ headerShown: true, title: 'Workout' }} />
      <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: 'Gym' }} />
      <Stack.Screen
        name="gym/new"
        options={{ headerShown: true, title: 'Add a gym', presentation: 'modal' }}
      />
      <Stack.Screen name="challenges/index" options={{ headerShown: true, title: 'Challenges' }} />
      <Stack.Screen
        name="challenges/new"
        options={{ headerShown: true, title: 'New challenge', presentation: 'modal' }}
      />
      <Stack.Screen
        name="challenges/daily"
        options={{ headerShown: true, title: 'Daily challenge' }}
      />
      <Stack.Screen name="challenges/[id]" options={{ headerShown: true, title: 'Challenge' }} />
    </Stack>
  );
}

/**
 * Status bar contrast, driven by the app's own scheme rather than `style="auto"`.
 *
 * `auto` follows the SYSTEM scheme, so a member who forced dark mode on a
 * light-mode phone got dark status-bar icons on the app's near-black canvas —
 * invisible. The bar has to follow whatever the app is actually painting.
 */
function ThemedStatusBar() {
  const theme = useTheme();
  return <StatusBar style={theme.isDark ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          {/*
            ConfirmProvider replaces React Native's Alert, which is a no-op on
            web (react-native-web ships `static alert() {}`). Without it every
            confirmation silently does nothing in a browser.
          */}
          <ConfirmProvider>
            <AuthProvider>
              <ThemedStatusBar />
              <RootNavigator />
            </AuthProvider>
          </ConfirmProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
