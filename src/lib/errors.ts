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
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = rawMessage(error);
  if (message === null) return fallback;
  if (isPolicyError(message)) return fallback;
  return message;
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
