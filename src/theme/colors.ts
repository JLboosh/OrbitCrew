/**
 * Colour tokens.
 *
 * Palette follows the reference design: a warm off-white sage canvas, white
 * cards, deep forest green as the single primary, and a warm coral used sparingly
 * for "live" and time-based accents.
 *
 * Two constraints carried over from the product rules:
 *
 * 1. ENCOURAGING, NOT ALARMING. There is no "bad" red for a missed session or a
 *    low ranking. Red exists only for destructive actions and genuine errors.
 *    Being behind on a goal renders as an unfilled neutral track.
 *
 * 2. ACCESSIBLE CONTRAST. Foreground/background pairings meet WCAG AA (4.5:1 for
 *    body text, 3:1 for large text and UI boundaries). The deep green on white is
 *    ~8:1; white on deep green is ~8:1.
 */

const palette = {
  // Deep forest green: buttons, progress fills, active states.
  green900: '#12321F',
  green800: '#1D4630',
  green700: '#2A5F41',
  green600: '#2E6042',
  green500: '#3C7A55',
  green300: '#8FBCA1',
  green200: '#C7DDCF',
  green100: '#E4EFE5',
  green50: '#EFF4EE',

  // Warm coral: "live" dots, early-morning and exploration accents. Never used
  // to signal failure.
  coral600: '#C9531F',
  coral500: '#E2622F',
  coral100: '#FBE8DF',

  // Supporting hue for avatars only, so identity colours are distinguishable
  // without implying status.
  blue500: '#3B6FD4',

  // Warm-tinted neutrals. Pure grey would read cold against the sage canvas.
  ink900: '#151A16',
  ink800: '#1F2620',
  ink700: '#3A453D',
  ink600: '#55635A',
  ink500: '#6B7A6F',
  ink400: '#93A197',
  ink300: '#BFC9C2',
  ink200: '#DCE3DD',
  ink100: '#ECF0EB',
  canvas: '#F1F4F0',
  white: '#FFFFFF',

  red600: '#C0392B',
  red100: '#FBE4E1',
  amber500: '#D97706',
} as const;

export interface ColorScheme {
  /** App canvas — deliberately not pure white, so white cards read as raised. */
  background: string;
  /** Card and sheet surfaces. */
  surface: string;
  /** Secondary grouping surface. */
  surfaceMuted: string;
  /** Tinted surface for the crew/goal feature card. */
  surfaceAccent: string;
  /** Two stops for the feature card's soft gradient. */
  gradientStart: string;
  gradientEnd: string;

  text: string;
  textMuted: string;
  textSubtle: string;
  textOnPrimary: string;

  primary: string;
  primaryPressed: string;
  primarySoft: string;

  /** "Live" and time-of-day accents. Not a warning colour. */
  accent: string;
  accentSoft: string;

  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;

  border: string;
  borderStrong: string;
  /** Unfilled portion of progress bars. */
  track: string;

  /** Avatar background rotation, keyed by a stable hash of the user id. */
  avatarPalette: readonly string[];
}

export const lightColors: ColorScheme = {
  background: palette.canvas,
  surface: palette.white,
  surfaceMuted: palette.green50,
  surfaceAccent: palette.green100,
  gradientStart: '#E9F1E8',
  gradientEnd: '#D7E6D8',

  text: palette.ink900,
  textMuted: palette.ink500,
  textSubtle: palette.ink400,
  textOnPrimary: palette.white,

  primary: palette.green600,
  primaryPressed: palette.green800,
  primarySoft: palette.green100,

  accent: palette.coral500,
  accentSoft: palette.coral100,

  success: palette.green600,
  successSoft: palette.green100,
  danger: palette.red600,
  dangerSoft: palette.red100,

  border: palette.ink200,
  borderStrong: palette.ink300,
  track: palette.ink200,

  avatarPalette: [palette.blue500, palette.coral500, palette.green600, palette.ink900],
};

export const darkColors: ColorScheme = {
  background: '#0F1511',
  surface: '#18201A',
  surfaceMuted: '#131A15',
  surfaceAccent: '#1B2A20',
  gradientStart: '#1B2A20',
  gradientEnd: '#14201A',

  text: '#EEF3EE',
  textMuted: palette.ink300,
  textSubtle: palette.ink400,
  textOnPrimary: palette.green900,

  primary: palette.green300,
  primaryPressed: palette.green200,
  primarySoft: '#1E2E23',

  accent: '#F08A57',
  accentSoft: '#33190E',

  success: palette.green300,
  successSoft: '#16281C',
  danger: '#EF8377',
  dangerSoft: '#331512',

  border: '#2A352D',
  borderStrong: '#3D4B41',
  track: '#2A352D',

  avatarPalette: ['#5B8AE6', '#F08A57', palette.green300, '#E8EFE7'],
};

export { palette };
