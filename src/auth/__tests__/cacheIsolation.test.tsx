import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';

/**
 * Cross-user cache isolation.
 *
 * THE BUG THIS PINS
 * -----------------
 * Almost every query key in `queryKeys` describes "mine" without saying whose:
 * `['challenges', 'mine']`, `['session', 'active']`, `['sessions']`, `['presence']`,
 * `['progress', ...]`, `['crews']`, `['badges', 'mine']`. The React Query cache
 * outlives a sign-out, so signing in as a second account served the FIRST
 * account's rows until `gcTime` expired.
 *
 * The symptom was specific and misleading: switching between the seeded demo
 * accounts showed a challenge list belonging to the previous member, and opening one
 * of those challenges hit RLS, came back empty, and rendered "not available". It read
 * as certain members being locked out of a challenge when in fact they were being
 * shown somebody else's.
 *
 * That is why the fix lives in `AuthProvider` rather than in each key: a query added
 * later inherits it, whereas remembering to thread a user id through every future key
 * would not survive one distracted afternoon.
 */

type AuthCallback = (event: string, session: unknown) => void;

// `mock`-prefixed so Jest permits the hoisted factory below to reference them.
const mockListeners: AuthCallback[] = [];
let mockSession: unknown = null;

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: (callback: AuthCallback) => {
        mockListeners.push(callback);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signInWithPassword: () => Promise.resolve({ error: null }),
      signOut: () => Promise.resolve({ error: null }),
      signUp: () => Promise.resolve({ error: null }),
    },
  },
}));

function sessionFor(userId: string) {
  return { user: { id: userId }, access_token: `token-${userId}` };
}

/** Emits an auth change the way supabase-js would. */
async function emit(session: unknown) {
  await act(async () => {
    mockSession = session;
    for (const listener of mockListeners) listener('TOKEN_REFRESHED', session);
  });
}

function Probe() {
  const { user } = useAuth();
  return <Text>{user?.id ?? 'signed-out'}</Text>;
}

async function mount(client: QueryClient, initial: unknown) {
  mockSession = initial;
  mockListeners.length = 0;

  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('query cache isolation across accounts', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    // Cache entries created directly with `setQueryData` schedule a garbage-collection
    // timer, and the default gcTime is five minutes. Without this, Jest reports an
    // open handle and force-exits the worker.
    client.clear();
  });

  it('drops the previous account data when a different member signs in', async () => {
    await mount(client, sessionFor('alex'));
    expect(await screen.findByText('alex')).toBeOnTheScreen();

    // Stand-ins for the keys that are not user-scoped.
    client.setQueryData(['challenges', 'mine'], [{ challenge_id: 'alex-daily' }]);
    client.setQueryData(['session', 'active'], { id: 'alex-session' });

    await emit(sessionFor('sam'));

    expect(client.getQueryData(['challenges', 'mine'])).toBeUndefined();
    expect(client.getQueryData(['session', 'active'])).toBeUndefined();
  });

  it('drops cached data on sign-out, so nothing survives to the next member', async () => {
    await mount(client, sessionFor('alex'));
    expect(await screen.findByText('alex')).toBeOnTheScreen();

    client.setQueryData(['badges', 'mine'], [{ badgeKey: 'crew_50' }]);

    await emit(null);

    expect(client.getQueryData(['badges', 'mine'])).toBeUndefined();
  });

  it('keeps the cache through a token refresh for the same member', async () => {
    // The counterexample that matters: clearing on every auth event would wipe the
    // cache mid-workout, because supabase-js re-emits on every token refresh.
    await mount(client, sessionFor('alex'));
    expect(await screen.findByText('alex')).toBeOnTheScreen();

    client.setQueryData(['session', 'active'], { id: 'alex-session' });

    await emit(sessionFor('alex'));

    expect(client.getQueryData(['session', 'active'])).toEqual({ id: 'alex-session' });
  });

  it('does not clear the cache while establishing the initial session', async () => {
    // A cold start resolves the persisted session asynchronously. Treating that
    // first resolution as a change would throw away a cache that was just filled.
    client.setQueryData(['sessions'], [{ id: 'restored' }]);

    await mount(client, sessionFor('alex'));
    expect(await screen.findByText('alex')).toBeOnTheScreen();

    expect(client.getQueryData(['sessions'])).toEqual([{ id: 'restored' }]);
  });
});
