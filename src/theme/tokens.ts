import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/** Spacing scale (4pt grid). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Generous radii, matching the reference design's soft card language.
 * Cards use `xl`; pills and avatars use `pill`.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 28,
  pill: 999,
} as const;

/**
 * Minimum touch target (Apple HIG 44pt, Material 48dp).
 * Logging sets happens mid-workout, one-handed, with low attention.
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Layout breakpoint.
 *
 * Below this the app is the phone layout with a bottom tab bar. At or above it
 * (realistically only a browser) it becomes the sidebar dashboard.
 */
export const WIDE_BREAKPOINT = 1024;

/** Max content width so the dashboard does not sprawl on very wide monitors. */
export const MAX_CONTENT_WIDTH = 1240;

export const typography = {
  /** Large editorial headline, e.g. "Make today count." */
  display: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '600',
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '400',
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  /**
   * Uppercase micro-label with wide tracking, used for dates and section
   * eyebrows ("SUNDAY, SEPTEMBER 14", "WATERLOO GYM CREW · 12 MEMBERS").
   */
  eyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  /** Large numerals: goals, session counts. */
  metric: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  /**
   * Timers. Tabular figures stop the clock from visibly jittering as digit
   * widths change.
   */
  mono: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Soft elevation.
 *
 * Kept subtle: the design separates surfaces mainly through the off-white canvas
 * versus white cards, with shadow as reinforcement rather than the main signal.
 */
export const shadow = {
  card: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#1B2A20',
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 2 },
    default: {
      // react-native-web understands boxShadow and it renders more faithfully
      // than the iOS shadow props.
      boxShadow: '0 6px 18px rgba(27, 42, 32, 0.07)',
    } as ViewStyle,
  })!,

  raised: Platform.select<ViewStyle>({
    ios: {
      shadowColor: '#1B2A20',
      shadowOpacity: 0.1,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 5 },
    default: { boxShadow: '0 10px 28px rgba(27, 42, 32, 0.10)' } as ViewStyle,
  })!,
} as const;

export const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});
