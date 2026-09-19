import {
  errorMessage,
  isNetworkError,
  isPolicyError,
  NETWORK_MESSAGE,
  rawMessage,
} from '@/lib/errors';

/**
 * The three kinds of failure this module has to tell apart, because each one needs
 * a different response from the member:
 *
 *   * TRANSPORT — nothing reached the server. Retyping a correct password will
 *     never help, so the message must not look like a credentials problem.
 *   * DATABASE PLUMBING — accurate but unreadable, so a written fallback is better.
 *   * A DELIBERATE SERVER MESSAGE — must reach the member exactly as written,
 *     because several product rules are communicated only through these.
 */

describe('isNetworkError', () => {
  it('recognises what each runtime actually emits', () => {
    // Browsers and undici.
    expect(isNetworkError('Failed to fetch')).toBe(true);
    expect(isNetworkError('TypeError: Failed to fetch')).toBe(true);
    // React Native.
    expect(isNetworkError('Network request failed')).toBe(true);
    // Node, surfaced through supabase-js.
    expect(isNetworkError('fetch failed')).toBe(true);
    expect(isNetworkError('connect ECONNREFUSED 127.0.0.1:54321')).toBe(true);
    expect(isNetworkError('getaddrinfo ENOTFOUND nope.supabase.co')).toBe(true);
  });

  it('is case-insensitive, since the casing differs between runtimes', () => {
    expect(isNetworkError('FAILED TO FETCH')).toBe(true);
  });

  it('does not claim a real server message is a transport failure', () => {
    // The word "network" appearing in a legitimate message must not hijack it.
    expect(isNetworkError('Your crew network settings were updated')).toBe(false);
    expect(isNetworkError('Invalid login credentials')).toBe(false);
    expect(isNetworkError('You can only rate a gym once every 30 days')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('replaces a transport failure with something actionable', () => {
    // This is the case that sent someone retyping a correct password: "Failed to
    // fetch" on a sign-in form reads as "wrong password".
    expect(errorMessage(new Error('Failed to fetch'), 'Could not sign in.')).toBe(NETWORK_MESSAGE);
  });

  it('names the likely causes rather than the mechanism', () => {
    expect(NETWORK_MESSAGE).toMatch(/connection/i);
    expect(NETWORK_MESSAGE).toMatch(/EXPO_PUBLIC_SUPABASE_URL/);
    expect(NETWORK_MESSAGE).not.toMatch(/failed to fetch/i);
  });

  it('handles a PostgrestError, which is a plain object and not an Error', () => {
    // The reason this helper exists: `err instanceof Error` is false here, so the
    // real message would otherwise be thrown away for the generic fallback.
    const postgrestError = {
      message: 'You can only rate a gym once every 30 days',
      code: 'P0001',
      details: null,
      hint: null,
    };

    expect(errorMessage(postgrestError, 'Could not save your rating.')).toBe(
      'You can only rate a gym once every 30 days',
    );
  });

  it('prefers the fallback for database plumbing', () => {
    const rls = { message: 'new row violates row-level security policy for table "challenges"' };
    expect(errorMessage(rls, 'Could not create that.')).toBe('Could not create that.');
  });

  it('falls back when there is no message at all', () => {
    expect(errorMessage(null, 'Could not sign in.')).toBe('Could not sign in.');
    expect(errorMessage({}, 'Could not sign in.')).toBe('Could not sign in.');
    expect(errorMessage('   ', 'Could not sign in.')).toBe('Could not sign in.');
  });

  it('passes a genuine credentials failure through unchanged', () => {
    // Distinguishable from the transport case, which is the whole point.
    expect(errorMessage({ message: 'Invalid login credentials' }, 'Could not sign in.')).toBe(
      'Invalid login credentials',
    );
  });
});

describe('rawMessage', () => {
  it('returns the message untouched, with no substitution', () => {
    expect(rawMessage(new Error('Failed to fetch'))).toBe('Failed to fetch');
    expect(rawMessage({ message: 'anything' })).toBe('anything');
    expect(rawMessage('a string')).toBe('a string');
    expect(rawMessage(undefined)).toBeNull();
  });
});

describe('isPolicyError', () => {
  it('stays narrow, so a deliberate trigger message always reaches the member', () => {
    expect(isPolicyError('new row violates row-level security policy')).toBe(true);
    expect(isPolicyError('violates check constraint "sets_reps_range"')).toBe(true);
    expect(isPolicyError('No session in progress')).toBe(false);
    expect(isPolicyError('That session does not belong to you')).toBe(false);
  });
});
