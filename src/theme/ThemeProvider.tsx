import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme, useWindowDimensions } from 'react-native';

import { darkColors, lightColors, type ColorScheme } from './colors';
import {
  MAX_CONTENT_WIDTH,
  MIN_TOUCH_TARGET,
  radius,
  shadow,
  spacing,
  typography,
  WIDE_BREAKPOINT,
} from './tokens';

export interface Theme {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: typeof shadow;
  minTouchTarget: number;
  maxContentWidth: number;
  isDark: boolean;
  /**
   * True on a wide viewport, where the app becomes the sidebar dashboard rather
   * than the phone layout. Realistically only a browser window.
   */
  isWide: boolean;
}

/**
 * What the member chose, which is not the same as what is currently rendered.
 *
 * `system` is a real, distinct choice rather than a synonym for whichever scheme
 * happens to be active: someone on `system` expects the app to follow their phone
 * when it flips at sunset, and collapsing it to `light`/`dark` at save time would
 * silently take that away.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Appearance {
  /** The member's stored preference. */
  mode: ThemeMode;
  /** What that preference resolves to right now. */
  resolved: 'light' | 'dark';
  setMode: (next: ThemeMode) => void;
  /** False until the stored preference has been read back from storage. */
  hydrated: boolean;
}

const ThemeContext = createContext<Theme | undefined>(undefined);
const AppearanceContext = createContext<Appearance | undefined>(undefined);

/**
 * Storage key for the appearance preference.
 *
 * Device-local rather than a column on `profiles`, deliberately. Dark mode is a
 * property of where you are — a phone in a dark gym versus a laptop at a desk —
 * so syncing it across devices would be the wrong behaviour, and it also means
 * the choice applies instantly on the sign-in screen, before there is a profile
 * to read.
 */
const THEME_MODE_KEY = 'gymcrew.appearance.mode';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const { width } = useWindowDimensions();

  const [mode, setModeState] = useState<ThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  // Read the stored preference once. Until it arrives the app follows the
  // system scheme, which is the closest thing to "correct" for a first launch
  // and avoids rendering nothing while storage is read.
  useEffect(() => {
    let active = true;

    AsyncStorage.getItem(THEME_MODE_KEY)
      .then((stored) => {
        if (!active) return;
        if (isThemeMode(stored)) setModeState(stored);
      })
      .catch(() => {
        // A storage read failure is not worth blocking the UI for; the member
        // simply gets the system scheme and can set it again.
      })
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // State first so the switch feels instant, then persist. A failed write
    // means the choice does not survive a restart, which is better than a
    // toggle that appears not to work.
    setModeState(next);
    AsyncStorage.setItem(THEME_MODE_KEY, next).catch(() => {});
  }, []);

  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const isDark = resolved === 'dark';
  const isWide = width >= WIDE_BREAKPOINT;

  const theme = useMemo<Theme>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typography,
      shadow,
      minTouchTarget: MIN_TOUCH_TARGET,
      maxContentWidth: MAX_CONTENT_WIDTH,
      isDark,
      isWide,
    }),
    [isDark, isWide],
  );

  const appearance = useMemo<Appearance>(
    () => ({ mode, resolved, setMode, hydrated }),
    [mode, resolved, setMode, hydrated],
  );

  return (
    <AppearanceContext.Provider value={appearance}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </AppearanceContext.Provider>
  );
}

/** Access design tokens. Never hardcode colours or spacing in a component. */
export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return context;
}

/** Read and change the light/dark preference. */
export function useAppearance(): Appearance {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error('useAppearance must be used inside a ThemeProvider');
  }
  return context;
}

/**
 * Deterministic avatar colour for a user id.
 *
 * Stable across renders and devices, so a member keeps the same colour
 * everywhere — which is what makes an avatar stack readable at a glance.
 */
export function avatarColor(seed: string, palette: readonly string[]): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  return palette[hash % palette.length]!;
}

/**
 * A readable text colour for an arbitrary background.
 *
 * Needed because the dark avatar palette contains near-white entries: hardcoding
 * white initials, which is fine on every light-mode avatar, made those avatars
 * blank in dark mode. Rather than restricting the palette to dark colours — which
 * would cost the distinguishability that is the whole point of an avatar colour —
 * the foreground follows the background.
 *
 * Uses relative luminance per WCAG 2.x, with the standard 0.179 crossover: above
 * it, black beats white for contrast, and below it the reverse.
 */
export function readableTextOn(background: string): string {
  const luminance = relativeLuminance(background);
  return luminance === null || luminance <= 0.179 ? '#FFFFFF' : '#101812';
}

/** WCAG relative luminance of a `#rgb`/`#rrggbb` colour, or null if unparseable. */
function relativeLuminance(color: string): number | null {
  const hex = color.trim().replace('#', '');

  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex;

  if (expanded.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  const channel = (offset: number) => {
    const value = Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
