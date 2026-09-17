import type { Session, User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { supabase } from '@/lib/supabase';

export interface AuthState {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been read from storage. */
  initialising: boolean;
}

export interface AuthContextValue extends AuthState {
  signUp: (input: SignUpInput) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface SignUpInput {
  email: string;
  password: string;
  displayName?: string;
  /** Optional preferred handle. The database resolves collisions automatically. */
  username?: string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Owns authentication state for the whole app.
 *
 * `initialising` matters: on cold start the persisted session is read
 * asynchronously from AsyncStorage. Routing before that resolves would briefly
 * bounce an already-signed-in member to the sign-in screen.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialising, setInitialising] = useState(true);

  const queryClient = useQueryClient();
  /**
   * The id the cache currently holds data for.
   *
   * `undefined` means "not established yet", which is distinct from `null` ("no
   * one is signed in") — the difference is what stops a cold start from throwing
   * away a cache that was just populated.
   */
  const cachedUserId = useRef<string | null | undefined>(undefined);

  /**
   * Discard cached data when the signed-in member changes.
   *
   * THIS FIXES A REAL, USER-VISIBLE BUG, not a hypothetical one. Most query keys
   * in `queryKeys` describe "mine" rather than "this user's": `['challenges',
   * 'mine']`, `['session', 'active']`, `['sessions']`, `['presence']`,
   * `['progress', ...]`, `['crews']`, `['badges', 'mine']`. Nothing about those
   * keys mentions who "mine" is, and the cache outlives a sign-out — so signing
   * in as a second account served the FIRST account's rows for up to `gcTime`.
   *
   * The symptom was specific and misleading: switching between the seeded demo
   * accounts showed a challenge list belonging to the previous member, and
   * opening one of those challenges hit RLS, returned no row, and rendered "not
   * available". It looked like certain members were locked out of a challenge.
   * They were not — they were being shown somebody else's.
   *
   * Clearing on identity change is the fix that cannot be forgotten: a new
   * user-scoped query added later inherits it for free, whereas remembering to
   * put a user id in every future key would not survive one distracted afternoon.
   */
  useEffect(() => {
    // The persisted session is read asynchronously, so until that resolves
    // `session` is null for a reason that is not "signed out". Acting on it would
    // make every cold start clear the cache.
    if (initialising) return;

    const nextUserId = session?.user?.id ?? null;

    if (cachedUserId.current === undefined) {
      cachedUserId.current = nextUserId;
      return;
    }
    // A token refresh re-emits the same user; that must not wipe the cache
    // mid-workout.
    if (cachedUserId.current === nextUserId) return;

    cachedUserId.current = nextUserId;
    queryClient.clear();
  }, [session, initialising, queryClient]);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
      })
      .finally(() => {
        if (active) setInitialising(false);
      });

    // Fires on sign-in, sign-out, and token refresh, keeping state in step with
    // the client rather than requiring every caller to re-read it.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initialising,

      async signUp({ email, password, displayName, username }: SignUpInput) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // Consumed by the handle_new_user trigger, which creates the profile
            // and the private-by-default privacy row.
            data: {
              display_name: displayName?.trim() || undefined,
              username: username?.trim() || undefined,
              // Lets time-of-day challenges and weekly resets be scored in the
              // member's own timezone from the very first session.
              timezone: getDeviceTimezone(),
            },
          },
        });
        if (error) throw error;
      },

      async signIn(email: string, password: string) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      },

      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },
    }),
    [session, initialising],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}

/**
 * Best-effort IANA timezone for the device.
 *
 * Falls back to UTC: the profiles table validates this against the server's
 * timezone database, and an unrecognised value would abort signup.
 */
function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
