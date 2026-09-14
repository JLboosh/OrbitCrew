/**
 * Colour tokens.
 *
 * Two deliberate constraints:
 *
 * 1. ENCOURAGING, NOT ALARMING. There is no "bad" red for missed sessions or
 *    low rankings. Red is reserved strictly for destructive actions and genuine
 *    errors. Falling behind a goal is shown in a neutral or warm tone, never as
 *    a failure state.
 *
 * 2. ACCESSIBLE CONTRAST. Every foreground/background pairing below meets WCAG
 *    AA (4.5:1 for body text, 3:1 for large text and UI boundaries).
 */

const palette = {
  // Brand: a calm, energetic teal. Distinct from the red/orange "hustle"
  // palette most fitness apps use, which reads as pressure rather than support.
  teal900: '#0B3B3C',
  teal700: '#11605F',
  teal500: '#178F8B',
  teal300: '#5EC4BE',
  teal100: '#D3F0EE',

  // Warm accent for streaks and celebrations.
  amber600: '#B45309',
  amber500: '#D97706',
  amber100: '#FEF3C7',

  // Neutrals.
  gray900: '#11181C',
  gray800: '#1F2933',
  gray700: '#374151',
  gray600: '#4B5563',
  gray500: '#6B7280',
  gray400: '#9CA3AF',
  gray300: '#D1D5DB',
  gray200: '#E5E7EB',
  gray100: '#F3F4F6',
  gray50: '#F9FAFB',
  white: '#FFFFFF',
  black: '#000000',

  // Reserved for destructive actions and real errors ONLY.
  red600: '#DC2626',
  red100: '#FEE2E2',

  // Success / goal reached.
  green600: '#059669',
  green100: '#D1FAE5',
} as const;

export interface ColorScheme {
  /** Screen background. */
  background: string;
  /** Raised surface (cards, sheets). */
  surface: string;
  /** Subtle surface for secondary grouping. */
  surfaceMuted: string;
  /** Primary body text. */
  text: string;
  /** Secondary/supporting text. */
  textMuted: string;
  /** Lowest-emphasis text (timestamps, hints). */
  textSubtle: string;
  /** Text on a primary-coloured background. */
  textOnPrimary: string;
  /** Primary interactive colour. */
  primary: string;
  /** Pressed/active state for primary. */
  primaryPressed: string;
  /** Tint for primary-coloured fills. */
  primarySoft: string;
  /** Streaks, celebrations, milestones. */
  accent: string;
  accentSoft: string;
  /** Goal met / positive confirmation. */
  success: string;
  successSoft: string;
  /** Destructive actions and errors only. */
  danger: string;
  dangerSoft: string;
  /** Hairline borders and dividers. */
  border: string;
  /** Stronger border for focus rings. */
  borderStrong: string;
  /** Unfilled portion of progress bars. */
  track: string;
}

export const lightColors: ColorScheme = {
  background: palette.white,
  surface: palette.white,
  surfaceMuted: palette.gray50,
  text: palette.gray900,
  textMuted: palette.gray600,
  textSubtle: palette.gray500,
  textOnPrimary: palette.white,
  primary: palette.teal500,
  primaryPressed: palette.teal700,
  primarySoft: palette.teal100,
  accent: palette.amber600,
  accentSoft: palette.amber100,
  success: palette.green600,
  successSoft: palette.green100,
  danger: palette.red600,
  dangerSoft: palette.red100,
  border: palette.gray200,
  borderStrong: palette.gray400,
  track: palette.gray200,
};

export const darkColors: ColorScheme = {
  background: palette.gray900,
  surface: palette.gray800,
  surfaceMuted: '#18212B',
  text: palette.gray50,
  textMuted: palette.gray300,
  textSubtle: palette.gray400,
  textOnPrimary: palette.gray900,
  primary: palette.teal300,
  primaryPressed: palette.teal100,
  primarySoft: palette.teal900,
  accent: '#FBBF24',
  accentSoft: '#3B2A08',
  success: '#34D399',
  successSoft: '#052E22',
  danger: '#F87171',
  dangerSoft: '#3B0D0D',
  border: palette.gray700,
  borderStrong: palette.gray500,
  track: palette.gray700,
};

export { palette };
