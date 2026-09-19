/**
 * Turns an unknown thrown value into something worth showing a member.
 *
 * WHY THIS EXISTS RATHER THAN `error instanceof Error`
 * ---------------------------------------------------
 * Supabase rejects with `PostgrestError`, which is a PLAIN OBJECT — it is not an
 * instance of Error. An `instanceof Error` check therefore fails and the real
 * message gets thrown away in favour of something generic.
 *
 * That is not cosmetic. Several product rules are communicated to members
 * entirely through these messages:
 *   * "You can only rate a gym once every 30 days" — the rating rate-limit trigger
 *   * "No session in progress" — end_session
 *   * "That session does not belong to you" — check_in
 *
 * Database CHECK-constraint and RLS failures are the exception: their text is
 * accurate but unreadable ("new row violates row-level security policy for table
 * ..."), so callers should pass a fallback and use `isPolicyError` to decide when
 * to prefer it.
 *
 * Transport failures are the other exception, and they are handled here rather
 * than left to callers: "Failed to fetch" is not a message about the operation the
 * member attempted, it means nothing ever reached the server. See
 * `NETWORK_MESSAGE`.
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = rawMessage(error);
  if (message === null) return fallback;
  if (isNetworkError(message)) return NETWORK_MESSAGE;
  if (isPolicyError(message)) return fallback;
  return message;
}

/**
 * What a member sees when the app cannot reach Supabase at all.
 *
 * The browser's own wording for this is "Failed to fetch" and React Native's is
 * "Network request failed" — both of which describe the mechanism and none of the
 * cause. Worse, on a sign-in screen they are indistinguishable from a wrong
 * password, so the natural response is to retype a correct password repeatedly.
 *
 * Deliberately names the two real causes in the order they are likely: no
 * connection, or an app pointed at a backend that is not there. The second is not
 * a member's problem in production, but it is overwhelmingly the cause during
 * development and for a tester running someone else's checkout, and it is
 * invisible otherwise.
 */
export const NETWORK_MESSAGE =
  'Could not reach the server. Check your connection — or, if you are running this locally, ' +
  'that EXPO_PUBLIC_SUPABASE_URL in .env points at a Supabase project that is actually running.';

/**
 * Whether a failure happened before any server was reached.
 *
 * Matched on message text because that is all there is: a transport failure never
 * gets an HTTP status or a `PostgrestError` code, so there is no structured field
 * to test. Kept to the exact strings the runtimes emit rather than anything
 * containing "network", so a genuine server message that happens to use the word
 * is still shown as written.
 */
export function isNetworkError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    // Browsers / undici.
    lowered === 'failed to fetch' ||
    lowered.includes('failed to fetch') ||
    // React Native.
    lowered.includes('network request failed') ||
    // Node / undici underlying causes, seen through supabase-js.
    lowered.includes('econnrefused') ||
    lowered.includes('enotfound') ||
    lowered.includes('fetch failed')
  );
}

/** The message as the server sent it, with no substitution. */
export function rawMessage(error: unknown): string | null {
  if (error == null) return null;

  if (typeof error === 'string') {
    return error.trim().length > 0 ? error : null;
  }

  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }

  return null;
}

/**
 * Whether a message is database plumbing rather than an explanation.
 *
 * These are correct but meaningless to a member, so a written fallback reads
 * better. Kept narrow on purpose: a deliberate `raise exception` from a trigger
 * must always reach the member.
 */
export function isPolicyError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('row-level security') ||
    lowered.includes('violates check constraint') ||
    lowered.includes('violates foreign key') ||
    lowered.includes('duplicate key value')
  );
}
