/**
 * "What day is it for this member, and when does that day start and end?"
 *
 * WHY THIS IS NOT `date.setHours(0, 0, 0, 0)`
 * ------------------------------------------
 * That gives midnight in the DEVICE's timezone. The daily challenge is scored
 * against absolute timestamps, and members are not all in one zone — the seeded
 * demo crew alone spans America/Toronto and America/Vancouver. A Vancouver
 * member opening the app at 9 PM local would, under device-midnight maths run on
 * a Toronto machine, be handed tomorrow's challenge, see 0 progress for a session
 * they had just finished, and conclude the feature was broken. Day boundaries have
 * to come from the member's own zone.
 *
 * HERMES ICU
 * ----------
 * React Native's Hermes engine ships a trimmed ICU on some builds, where
 * `Intl.DateTimeFormat` either throws on a `timeZone` option or ignores it. Every
 * function here therefore degrades to the device's own local day rather than
 * throwing, and `supportsTimeZones()` reports which happened so the UI can say so
 * instead of quietly showing the wrong window.
 */

/** `YYYY-MM-DD`, the calendar date in `timeZone` at the instant `now`. */
export function localDayKey(timeZone: string, now: Date = new Date()): string {
  const parts = zonedParts(timeZone, now);
  if (!parts) return deviceDayKey(now);
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export interface DayBounds {
  /** Inclusive start: midnight at the beginning of the day, as an absolute instant. */
  start: Date;
  /** Exclusive end: midnight at the beginning of the next day. */
  end: Date;
  /** `YYYY-MM-DD` for the day these bounds describe. */
  dayKey: string;
}

/**
 * The absolute instants bounding the member's local day.
 *
 * The offset is resolved twice on purpose. A zone's UTC offset is itself a
 * function of the instant, so the offset "now" is not necessarily the offset at
 * local midnight — on a spring-forward Sunday they differ by an hour. Computing a
 * first guess and then re-resolving the offset at that guess fixes the boundary
 * for every real transition.
 */
export function localDayBounds(timeZone: string, now: Date = new Date()): DayBounds {
  const parts = zonedParts(timeZone, now);

  if (!parts) {
    // No usable timezone support: fall back to the device's own day, which is at
    // least self-consistent.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, dayKey: deviceDayKey(now) };
  }

  const start = zonedMidnight(timeZone, parts.year, parts.month, parts.day);
  // Adding 24 hours would be wrong across a DST transition, so the next day's
  // midnight is resolved the same way the current one was.
  const nextParts = addDays(parts.year, parts.month, parts.day, 1);
  const end = zonedMidnight(timeZone, nextParts.year, nextParts.month, nextParts.day);

  return {
    start,
    end,
    dayKey: `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`,
  };
}

/** Day keys for the last `count` days in `timeZone`, most recent first. */
export function recentDayKeys(timeZone: string, count: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  const bounds = localDayBounds(timeZone, now);

  let cursor = bounds.start;
  for (let index = 0; index < Math.max(count, 0); index += 1) {
    keys.push(localDayKey(timeZone, cursor));
    // Steps back 12 hours short of a full day, then re-resolves. Landing
    // mid-morning rather than exactly on midnight means a DST shift cannot push
    // the cursor onto the wrong side of a boundary and duplicate or skip a day.
    cursor = new Date(cursor.getTime() - 12 * 60 * 60 * 1000);
    cursor = localDayBounds(timeZone, cursor).start;
  }

  return keys;
}

/**
 * Whether `Intl` in this runtime honours a `timeZone` option.
 *
 * Worth surfacing: when it does not, day boundaries follow the device instead of
 * the member's profile, and the UI should say so rather than imply otherwise.
 */
export function supportsTimeZones(): boolean {
  return zonedParts('America/Toronto', new Date()) !== null;
}

/**
 * A usable IANA timezone for a member.
 *
 * Prefers the profile value, which the `profiles_timezone_valid` CHECK has
 * already validated against the server's timezone database — that matters because
 * `challenges` carries the same constraint, so an unrecognised string would make
 * creating the challenge fail rather than merely mis-window it. Falls back to the
 * device, then UTC.
 */
export function resolveTimezone(profileTimezone: string | null | undefined): string {
  const fromProfile = profileTimezone?.trim();
  if (fromProfile) return fromProfile;

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Wall-clock parts in `timeZone`, or null when the runtime cannot do it. */
function zonedParts(timeZone: string, at: Date): ZonedParts | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const found: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const part of formatter.formatToParts(at)) {
      found[part.type] = part.value;
    }

    const year = Number(found.year);
    const month = Number(found.month);
    const day = Number(found.day);
    // `hour12: false` yields 24 rather than 0 for midnight in some ICU versions.
    const hour = Number(found.hour) % 24;
    const minute = Number(found.minute);
    const second = Number(found.second);

    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

/** The absolute instant of midnight on a given calendar date in `timeZone`. */
function zonedMidnight(timeZone: string, year: number, month: number, day: number): Date {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);

  const firstGuess = new Date(wallClockAsUtc - offsetMs(timeZone, new Date(wallClockAsUtc)));
  // Second pass: the offset that applies AT the boundary, not the one that
  // applied twelve hours earlier.
  return new Date(wallClockAsUtc - offsetMs(timeZone, firstGuess));
}

/**
 * Calendar arithmetic on plain Y/M/D, with no timezone involved.
 *
 * Done through `Date.UTC` so month lengths and leap years are handled by the
 * runtime rather than by hand, and in UTC specifically so no local offset can
 * shift the result across a day boundary.
 */
function addDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function offsetMs(timeZone: string, at: Date): number {
  const parts = zonedParts(timeZone, at);
  if (!parts) return 0;

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Seconds precision is all `formatToParts` gives, so drop the milliseconds on
  // both sides rather than letting them show up as a spurious offset.
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function deviceDayKey(now: Date): string {
  return `${pad4(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}
