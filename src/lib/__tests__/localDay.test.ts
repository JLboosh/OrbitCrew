import {
  localDayBounds,
  localDayKey,
  recentDayKeys,
  resolveTimezone,
  supportsTimeZones,
} from '@/lib/localDay';

/**
 * The daily challenge is a one-day window scored against absolute timestamps, so
 * these boundaries ARE the feature. Getting them from the device instead of the
 * member's profile is what would hand a Vancouver member tomorrow's challenge at
 * 9 PM and show them zero progress for a workout they had just finished.
 *
 * The seeded demo accounts deliberately span two zones (Toronto and Vancouver), so
 * the multi-timezone cases below are the demo, not a hypothetical.
 */

const TORONTO = 'America/Toronto';
const VANCOUVER = 'America/Vancouver';

describe('localDayKey', () => {
  it('agrees between zones when the instant is unambiguous', () => {
    const instant = new Date('2026-09-17T20:00:00Z');

    expect(localDayKey(TORONTO, instant)).toBe('2026-09-17');
    expect(localDayKey(VANCOUVER, instant)).toBe('2026-09-17');
  });

  it('resolves the day in the member zone, not in UTC', () => {
    // 03:00 UTC on the 18th is 23:00 on the 17th in Toronto (UTC-4 in September).
    // Scoring this in UTC would credit the session to the wrong day.
    const instant = new Date('2026-09-18T03:00:00Z');

    expect(localDayKey('UTC', instant)).toBe('2026-09-18');
    expect(localDayKey(TORONTO, instant)).toBe('2026-09-17');
  });

  it('separates two members in different zones at the boundary instant', () => {
    // 05:30 UTC: already the 18th in Toronto (01:30), still the 17th in Vancouver
    // (22:30). Both are correct, and both must get their own day.
    const instant = new Date('2026-09-18T05:30:00Z');

    expect(localDayKey(TORONTO, instant)).toBe('2026-09-18');
    expect(localDayKey(VANCOUVER, instant)).toBe('2026-09-17');
  });

  it('formats as YYYY-MM-DD, which is what the idempotency index keys on', () => {
    expect(localDayKey(TORONTO, new Date('2026-01-05T18:00:00Z'))).toBe('2026-01-05');
  });
});

describe('localDayBounds', () => {
  it('spans exactly one day on an ordinary date', () => {
    const { start, end, dayKey } = localDayBounds(TORONTO, new Date('2026-09-17T18:00:00Z'));

    expect(dayKey).toBe('2026-09-17');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('starts at local midnight rather than UTC midnight', () => {
    const { start } = localDayBounds(TORONTO, new Date('2026-09-17T18:00:00Z'));

    // Toronto is UTC-4 in September, so local midnight is 04:00 UTC.
    expect(start.toISOString()).toBe('2026-09-17T04:00:00.000Z');
  });

  it('produces a 23-hour day across the spring-forward transition', () => {
    // 8 March 2026 is the US/Canada DST start. Adding 24 hours to midnight would
    // put the window an hour into the 9th and mis-score a late Sunday session.
    const { start, end } = localDayBounds(TORONTO, new Date('2026-03-08T15:00:00Z'));
    const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(23);
  });

  it('produces a 25-hour day across the autumn-back transition', () => {
    // 1 November 2026 is the US/Canada DST end.
    const { start, end } = localDayBounds(TORONTO, new Date('2026-11-01T15:00:00Z'));
    const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);

    expect(hours).toBe(25);
  });

  it('gives members in different zones windows offset by their difference', () => {
    const instant = new Date('2026-09-17T18:00:00Z');

    const toronto = localDayBounds(TORONTO, instant);
    const vancouver = localDayBounds(VANCOUVER, instant);

    // Vancouver's day starts three hours after Toronto's.
    const offsetHours = (vancouver.start.getTime() - toronto.start.getTime()) / (60 * 60 * 1000);
    expect(offsetHours).toBe(3);
  });

  it('contains the instant it was asked about', () => {
    const instant = new Date('2026-09-17T18:00:00Z');
    const { start, end } = localDayBounds(VANCOUVER, instant);

    expect(start.getTime()).toBeLessThanOrEqual(instant.getTime());
    expect(end.getTime()).toBeGreaterThan(instant.getTime());
  });

  it('handles a zone with a half-hour offset', () => {
    const { start } = localDayBounds('Asia/Kolkata', new Date('2026-09-17T18:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-16T18:30:00.000Z');
  });

  it('falls back to a self-consistent device day for an unusable timezone', () => {
    // Mirrors a trimmed-ICU Hermes build: the window must still be a real day
    // rather than a crash or a zero-length range.
    const { start, end } = localDayBounds('Not/AZone', new Date('2026-09-17T18:00:00Z'));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe('recentDayKeys', () => {
  it('returns the requested number of days, most recent first', () => {
    const keys = recentDayKeys(TORONTO, 7, new Date('2026-09-17T18:00:00Z'));

    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-09-17');
    expect(keys[6]).toBe('2026-09-11');
  });

  it('never repeats or skips a day across a DST transition', () => {
    const keys = recentDayKeys(TORONTO, 7, new Date('2026-11-03T18:00:00Z'));

    expect(new Set(keys).size).toBe(7);
    expect(keys).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
      '2026-10-31',
      '2026-10-30',
      '2026-10-29',
      '2026-10-28',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    const keys = recentDayKeys(TORONTO, 3, new Date('2026-10-01T18:00:00Z'));
    expect(keys).toEqual(['2026-10-01', '2026-09-30', '2026-09-29']);
  });

  it('returns nothing for a non-positive count', () => {
    expect(recentDayKeys(TORONTO, 0)).toEqual([]);
  });
});

describe('resolveTimezone', () => {
  it('prefers the profile value, which the database has already validated', () => {
    expect(resolveTimezone(VANCOUVER)).toBe(VANCOUVER);
  });

  it('falls back when a profile has no usable timezone', () => {
    // The exact fallback depends on the host, so the assertion is that SOMETHING
    // usable comes back rather than an empty string.
    expect(resolveTimezone(null).length).toBeGreaterThan(0);
    expect(resolveTimezone('   ').length).toBeGreaterThan(0);
    expect(resolveTimezone(undefined).length).toBeGreaterThan(0);
  });
});

describe('supportsTimeZones', () => {
  it('reports whether the runtime honours a timeZone option', () => {
    // Under Node this is true; on a trimmed-ICU Hermes build it is false and the
    // UI says so rather than silently using the device day.
    expect(typeof supportsTimeZones()).toBe('boolean');
  });
});
