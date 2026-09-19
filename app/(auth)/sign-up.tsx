import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Screen, Text } from '@/components/ui';
import { BRANDING } from '@/constants/branding';
import { useTheme } from '@/theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { signUp } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !submitting;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const { needsEmailConfirmation } = await signUp({ email, password, displayName });

      /**
       * Move to sign-in rather than sitting here.
       *
       * Email confirmation means there is no session, so the root layout has
       * nothing to react to and this screen would just keep showing a filled-in
       * create-account form. The member then confirms in their mail client, comes
       * back, and is still looking at the form they already submitted — which
       * reads as though the sign-up never worked.
       *
       * The "check your email" instruction travels with them, so it is still on
       * screen at the place they have to return to anyway.
       */
      if (needsEmailConfirmation) {
        router.replace('/(auth)/sign-in?pending=1');
        return;
      }

      // Confirmation disabled: a session already exists and the root layout is
      // about to route into the app, so there is nothing to say.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
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
    <Screen title={`Join ${BRANDING.displayName}`} subtitle={BRANDING.tagline}>
      <Card>
        <View style={{ gap: theme.spacing.md }}>
          <View style={{ gap: theme.spacing.xs }}>
            <Text variant="caption" tone="muted">
              Name
            </Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              accessibilityLabel="Your name"
              autoComplete="name"
              placeholder="How your crew sees you"
              placeholderTextColor={theme.colors.textSubtle}
              style={inputStyle}
            />
          </View>

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
              autoComplete="new-password"
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
            label="Create account"
            size="large"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={handleSubmit}
          />
        </View>
      </Card>

      {/*
        Stated up front, because the product's central promise is that it is not
        invasive. These are the actual database defaults, not marketing copy.
      */}
      <Card>
        <Text variant="subheading">Private by default</Text>
        <Text variant="caption" tone="muted">
          Nobody can see where you train, when you are at the gym, or what you lift until you turn
          sharing on. Crews are invite-only. You can change any of this later in your profile.
        </Text>
      </Card>

      <View style={{ alignItems: 'center' }}>
        <Link href="/(auth)/sign-in" asChild>
          <Button label="I already have an account" variant="ghost" />
        </Link>
      </View>
    </Screen>
  );
}
