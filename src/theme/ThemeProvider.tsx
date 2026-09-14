import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ColorScheme } from './colors';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from './tokens';

export interface Theme {
  colors: ColorScheme;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  minTouchTarget: number;
  isDark: boolean;
}

function buildTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? darkColors : lightColors,
    spacing,
    radius,
    typography,
    minTouchTarget: MIN_TOUCH_TARGET,
    isDark,
  };
}

const ThemeContext = createContext<Theme>(buildTheme(false));

/**
 * Provides the theme, following the device light/dark preference.
 *
 * A context (rather than a bare import) means a future in-app appearance
 * override, or a fixed theme in tests, requires no changes at call sites.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const isDark = systemScheme === 'dark';

  const theme = useMemo(() => buildTheme(isDark), [isDark]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Access design tokens. Never hardcode colours or spacing in a component. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
