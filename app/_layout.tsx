import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';
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
  const { initialising } = useAuth();
  const theme = useTheme();
  useProtectedRoute();

  if (initialising) {
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
      <Stack.Screen
        name="session/active"
        options={{
          headerShown: true,
          title: 'Active session',
          // Presented as a sheet: logging happens on top of whatever the member
          // was doing, and dismissing must not lose the session.
          presentation: 'modal',
        }}
      />
      <Stack.Screen name="gym/[id]" options={{ headerShown: true, title: 'Gym' }} />
      <Stack.Screen name="challenges/index" options={{ headerShown: true, title: 'Challenges' }} />
      <Stack.Screen
        name="challenges/new"
        options={{ headerShown: true, title: 'New challenge', presentation: 'modal' }}
      />
      <Stack.Screen name="challenges/[id]" options={{ headerShown: true, title: 'Challenge' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="auto" />
            <RootNavigator />
          </AuthProvider>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
