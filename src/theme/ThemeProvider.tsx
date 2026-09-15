import { createContext, useContext, useMemo, type ReactNode } from 'react';
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

const ThemeContext = createContext<Theme | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const { width } = useWindowDimensions();

  const isDark = systemScheme === 'dark';
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

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Access design tokens. Never hardcode colours or spacing in a component. */
export function useTheme(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
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
