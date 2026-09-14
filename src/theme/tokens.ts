import { Platform } from 'react-native';

/**
 * Spacing scale (4pt grid). Using tokens instead of ad-hoc numbers keeps
 * rhythm consistent across screens built by different developers.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Minimum touch target, per Apple HIG (44pt) and Material (48dp).
 * Interactive components must not go below this — important here because
 * logging sets happens mid-workout with sweaty hands and low attention.
 */
export const MIN_TOUCH_TARGET = 44;

export const typography = {
  /** Screen titles. */
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  /** Section headings. */
  heading: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  /** Card titles and emphasised rows. */
  subheading: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  /** Default body copy. */
  body: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
  },
  /** Supporting copy and helper text. */
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  /** Large numerals: weights, timers, session counts. */
  metric: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    // Tabular figures stop the workout timer from visibly jittering as digits
    // change width.
    fontVariant: ['tabular-nums'],
  },
} as const;

export const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});
