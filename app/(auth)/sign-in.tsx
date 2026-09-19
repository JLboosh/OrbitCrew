import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Screen, Text } from '@/components/ui';
import { BRANDING } from '@/constants/branding';
import { errorMessage } from '@/lib/errors';
import { useTheme } from '@/theme';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();

  /**
   * Set by the sign-up screen when the new account still needs its email
   * confirmed. Carried in the route rather than in shared state so it survives the
   * navigation and disappears on its own the next time this screen is opened
   * normally.
   */
  const { pending } = useLocalSearchParams<{ pending?: string }>();
  const awaitingConfirmation = pending === '1';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      // Routing is handled centrally by the root layout once the session lands.
    } catch (err) {
      // Through `errorMessage` rather than `err.message`: an unreachable server
      // reports "Failed to fetch", which on this screen is indistinguishable from
      // a wrong password and sends people into retyping a correct one.
      setError(errorMessage(err, 'Could not sign in.'));
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    minHeight: theme.minTouchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    backgroundColor: theme.colors.surface,
    fontSize: 16,
  };

  return (
    <Screen title={BRANDING.displayName} subtitle={BRANDING.tagline}>
      {awaitingConfirmation ? (
        <Card variant="outline">
          <Text variant="subheading">Almost there</Text>
          <Text variant="caption" tone="muted">
            Your account is created. Click the link in the email we sent to confirm it, then sign in
            below.
          </Text>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading" heading>
          {awaitingConfirmation ? 'Sign in' : 'Welcome back'}
        </Text>

        <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              Email
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              placeholder="you@example.com"
              placeholderTextColor={theme.colors.textSubtle}
              style={inputStyle}
            />
          </View>

          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              Password
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="current-password"
              secureTextEntry
              placeholder="At least 6 characters"
              placeholderTextColor={theme.colors.textSubtle}
              style={inputStyle}
            />
          </View>

          {error ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button
            label="Sign in"
            size="large"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      </Card>

      <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
        <Text variant="caption" tone="muted">
          New here?
        </Text>
        <Link href="/(auth)/sign-up" asChild>
          <Button label="Create an account" variant="ghost" />
        </Link>
      </View>
    </Screen>
  );
}
