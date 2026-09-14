/**
 * A deliberately narrow reader for OpenStreetMap `opening_hours` values.
 *
 * WHY NOT A FULL PARSER
 * ---------------------
 * The OSM opening_hours specification is genuinely large: public-holiday rules,
 * seasonal ranges, week numbers, sunrise/sunset offsets, comments, fallback
 * rules. Implementing it partially and pretending otherwise is the dangerous
 * option, because the failure mode is telling a member a gym is closed when it
 * is open, or sending them to one that is shut.
 *
 * So this reader understands a common subset and, crucially, REPORTS WHEN IT DOES
 * NOT UNDERSTAND. `isOpenNow` is `null` for anything outside the subset, and the
 * UI falls back to showing the raw value as written by the mapper. Unknown is an
 * honest answer; a confident guess is not.
 *
 * Understood subset:
 *   24/7
 *   Mo-Fr 06:00-22:00
 *   Mo-Fr 06:00-22:00; Sa,Su 08:00-20:00
 *   Mo-Su 05:00-24:00
 *   06:00-22:00                (no day spec means every day)
 *   Mo-Fr 09:00-12:00,13:00-18:00
 *   Su off
 */

const DAY_TOKENS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const;

interface Interval {
  /** Minutes from local midnight. */
  startMinute: number;
  /** Minutes from local midnight; may exceed 1440 when the range crosses midnight. */
  endMinute: number;
}

export interface OpeningHoursReading {
  /** The value exactly as stored, always safe to display. */
  raw: string;
  /** True/false when confidently determined, null when the value was not understood. */
  isOpenNow: boolean | null;
  /** Today's hours, e.g. "06:00–22:00". Null when not understood. */
  todayLabel: string | null;
  /** True for "24/7". */
  alwaysOpen: boolean;
  /** False when the expression fell outside the supported subset. */
  understood: boolean;
}

export function readOpeningHours(
  raw: string | null | undefined,
  now: Date = new Date(),
): OpeningHoursReading | null {
  if (!raw || raw.trim().length === 0) return null;

  const value = raw.trim();
  const unknown: OpeningHoursReading = {
    raw: value,
    isOpenNow: null,
    todayLabel: null,
    alwaysOpen: false,
    understood: false,
  };

  if (/^24\s*\/\s*7$/i.test(value)) {
    return {
      raw: value,
      isOpenNow: true,
      todayLabel: 'Open 24 hours',
      alwaysOpen: true,
      understood: true,
    };
  }

  const perDay = parseRules(value);
  if (!perDay) return unknown;

  // JS weekdays run Sunday-first; the OSM tokens run Monday-first.
  const todayIndex = (now.getDay() + 6) % 7;
  const yesterdayIndex = (todayIndex + 6) % 7;
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  const todayIntervals = perDay[todayIndex] ?? [];
  const yesterdayIntervals = perDay[yesterdayIndex] ?? [];

  const openToday = todayIntervals.some(
    (interval) => minutesNow >= interval.startMinute && minutesNow < interval.endMinute,
  );

  // A range like Fr 20:00-02:00 is still in effect during Saturday's early hours.
  const openFromYesterday = yesterdayIntervals.some(
    (interval) =>
      interval.endMinute > 24 * 60 &&
      minutesNow + 24 * 60 >= interval.startMinute &&
      minutesNow + 24 * 60 < interval.endMinute,
  );

  return {
    raw: value,
    isOpenNow: openToday || openFromYesterday,
    todayLabel: todayIntervals.length > 0 ? formatIntervals(todayIntervals) : 'Closed today',
    alwaysOpen: false,
    understood: true,
  };
}

/**
 * Expands the expression into intervals per weekday, or null when any part of it
 * falls outside the supported subset.
 */
function parseRules(value: string): Interval[][] | null {
  const perDay: Interval[][] = [[], [], [], [], [], [], []];
  const rules = value.split(';');
  let sawAnything = false;

  for (const rawRule of rules) {
    const rule = rawRule.trim();
    if (rule.length === 0) continue;

    // Anything carrying a modifier we do not model must not be guessed at.
    // Matched on whole tokens: a substring test would reject "closed" for
    // containing "se", and reject nothing reliably.
    if (/\b(ph|sh|easter|su[nr]rise|sunset|week\d)\b/i.test(rule)) return null;
    if (/[+"|]/.test(rule)) return null;

    const split = splitDaysFromTimes(rule);
    if (!split) return null;

    const days = split.dayPart === null ? [0, 1, 2, 3, 4, 5, 6] : parseDaySpec(split.dayPart);
    if (!days || days.length === 0) return null;

    if (/^off$|^closed$/i.test(split.timePart)) {
      for (const day of days) perDay[day] = [];
      sawAnything = true;
      continue;
    }

    const intervals = parseTimeRanges(split.timePart);
    if (!intervals) return null;

    for (const day of days) {
      perDay[day] = intervals.slice();
    }
    sawAnything = true;
  }

  return sawAnything ? perDay : null;
}

/**
 * Separates the optional day specification from the time specification.
 *
 * The boundary is the first digit: day tokens are alphabetic, times are not.
 */
function splitDaysFromTimes(rule: string): { dayPart: string | null; timePart: string } | null {
  if (/^(off|closed)$/i.test(rule)) return { dayPart: null, timePart: 'off' };

  const firstDigit = rule.search(/\d/);

  if (firstDigit === -1) {
    // No digits at all: only "Su off" style rules are valid here.
    const match = /^([A-Za-z,\-\s]+?)\s+(off|closed)$/i.exec(rule);
    if (!match) return null;
    const dayPart = match[1];
    if (dayPart === undefined) return null;
    return { dayPart: dayPart.trim(), timePart: 'off' };
  }

  if (firstDigit === 0) return { dayPart: null, timePart: rule.trim() };

  const dayPart = rule.slice(0, firstDigit).trim();
  const timePart = rule.slice(firstDigit).trim();
  if (dayPart.length === 0) return null;

  return { dayPart, timePart };
}

/** "Mo-Fr,Su" -> [0,1,2,3,4,6]. Null when a token is unrecognised. */
function parseDaySpec(spec: string): number[] | null {
  const days = new Set<number>();

  for (const rawToken of spec.split(',')) {
    const token = rawToken.trim().toLowerCase();
    if (token.length === 0) continue;

    const range = /^([a-z]{2})\s*-\s*([a-z]{2})$/.exec(token);
    if (range) {
      const from = dayIndex(range[1]);
      const to = dayIndex(range[2]);
      if (from === null || to === null) return null;

      // Wrapping ranges such as Sa-Su or Fr-Mo are valid in OSM.
      let cursor = from;
      for (let step = 0; step < 7; step += 1) {
        days.add(cursor);
        if (cursor === to) break;
        cursor = (cursor + 1) % 7;
      }
      continue;
    }

    const single = dayIndex(token);
    if (single === null) return null;
    days.add(single);
  }

  return Array.from(days).sort((a, b) => a - b);
}

function dayIndex(token: string | undefined): number | null {
  if (!token) return null;
  const index = DAY_TOKENS.indexOf(token.toLowerCase() as (typeof DAY_TOKENS)[number]);
  return index === -1 ? null : index;
}

/** "09:00-12:00,13:00-18:00" -> two intervals. Null when unparseable. */
function parseTimeRanges(spec: string): Interval[] | null {
  const intervals: Interval[] = [];

  for (const rawRange of spec.split(',')) {
    const range = rawRange.trim();
    if (range.length === 0) continue;

    const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(range);
    if (!match) return null;

    const startMinute = toMinutes(match[1], match[2]);
    const endRaw = toMinutes(match[3], match[4]);
    if (startMinute === null || endRaw === null) return null;

    // Equal or reversed bounds mean the range crosses midnight (e.g. 20:00-02:00).
    const endMinute = endRaw <= startMinute ? endRaw + 24 * 60 : endRaw;
    intervals.push({ startMinute, endMinute });
  }

  return intervals.length > 0 ? intervals : null;
}

function toMinutes(hours: string | undefined, minutes: string | undefined): number | null {
  if (hours === undefined || minutes === undefined) return null;

  const h = Number.parseInt(hours, 10);
  const m = Number.parseInt(minutes, 10);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;

  return h * 60 + m;
}

function formatIntervals(intervals: Interval[]): string {
  return intervals
    .map((interval) => `${clockLabel(interval.startMinute)}–${clockLabel(interval.endMinute)}`)
    .join(', ');
}

function clockLabel(minute: number): string {
  // Exactly midnight-end ("00:00-24:00") reads better as 24:00 than 00:00.
  // Anything BEYOND 1440 is a range that crossed midnight, and must wrap
  // normally — otherwise "20:00-02:00" would render its end as "24:00".
  if (minute === 24 * 60) return '24:00';

  const normalised = ((minute % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalised / 60);
  const minutes = normalised % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
