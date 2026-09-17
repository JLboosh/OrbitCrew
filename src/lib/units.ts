import type { Database } from '@/types/database';

export type WeightUnit = Database['public']['Enums']['weight_unit'];

/**
 * Unit conversion and formatting for DISPLAY ONLY.
 *
 * The database is the source of truth for every number here: `sets.weight_kg`
 * and `sets.estimated_1rm_kg` are generated columns, and all aggregation happens
 * in kilograms. These helpers exist so a member who logs in pounds reads their
 * progress in pounds — nothing converted here is ever written back.
 *
 * 1 lb is exactly 0.45359237 kg by definition, matching the constant used in the
 * `sets` generated columns. Keeping the two identical means a value shown in the
 * app and the same value used for scoring never disagree by a rounding step.
 */
export const KG_PER_LB = 0.45359237;

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/** Converts a canonical kilogram value into the member's preferred unit. */
export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? kg : kgToLb(kg);
}

export interface FormatWeightOptions {
  /** Decimal places. Defaults to 0, which is the right precision for a barbell. */
  decimals?: number;
  /** Set false to return the bare number without a unit suffix. */
  withUnit?: boolean;
}

/**
 * Formats a canonical kilogram weight for display.
 *
 * Returns an em dash for null/undefined rather than "0", because "no data" and
 * "zero weight" mean different things — a bodyweight set legitimately has no
 * weight, and showing it as 0 lb would read as a failure to log.
 */
export function formatWeight(
  kg: number | null | undefined,
  unit: WeightUnit,
  options: FormatWeightOptions = {},
): string {
  if (kg == null || !Number.isFinite(kg)) return '—';

  const { decimals = 0, withUnit = true } = options;
  const value = fromKg(kg, unit);
  const rounded = value.toFixed(decimals);

  return withUnit ? `${addThousands(rounded)} ${unit}` : addThousands(rounded);
}

/**
 * Formats a training-volume total, which reaches five or six figures quickly.
 *
 * Abbreviated above 10,000 because "18.2k lb" is legible at a glance on a stat
 * tile while "18,143 lb" is not, and volume is a trend indicator rather than a
 * figure anyone needs to the pound.
 */
export function formatVolume(kg: number | null | undefined, unit: WeightUnit): string {
  if (kg == null || !Number.isFinite(kg)) return '—';

  const value = fromKg(kg, unit);
  if (value === 0) return `0 ${unit}`;
  if (value < 10_000) return `${addThousands(Math.round(value).toString())} ${unit}`;

  const thousands = value / 1000;
  const decimals = thousands < 100 ? 1 : 0;
  return `${thousands.toFixed(decimals)}k ${unit}`;
}

/** Reps and other plain counts. Kept here so all numeric display is consistent. */
export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return addThousands(Math.round(value).toString());
}

/**
 * A signed percentage, e.g. "+37%".
 *
 * Always signed: an improvement figure without a sign is ambiguous, and the
 * product rule is that every percentage must be unambiguous and traceable to the
 * measurement beside it.
 */
export function formatPercentDelta(percent: number | null | undefined): string | null {
  if (percent == null || !Number.isFinite(percent)) return null;

  const rounded = Math.round(percent * 10) / 10;
  const shown = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return rounded > 0 ? `+${shown}%` : `${shown}%`;
}

/** Durations in seconds, rendered as "48 min" or "1 h 12 min". */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

/**
 * Groups thousands with commas.
 *
 * Hand-rolled rather than using `toLocaleString`, because React Native's Hermes
 * engine ships a trimmed ICU and locale grouping is not reliably available on
 * Android. A wrong-looking number is worse than a plainly-formatted one.
 */
function addThousands(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '', fraction] = unsigned.split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const joined = fraction ? `${grouped}.${fraction}` : grouped;

  return negative ? `-${joined}` : joined;
}
