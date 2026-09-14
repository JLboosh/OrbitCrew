import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@/theme';

/**
 * Fixed safe-area metrics for tests.
 *
 * `SafeAreaProvider` normally measures the native view asynchronously, which
 * never happens under Jest — so `useSafeAreaInsets()` throws
 * "No safe area value available". Supplying `initialMetrics` makes insets
 * synchronous and deterministic.
 */
const TEST_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // Retries would make a failing query take seconds to surface in a test.
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions {
  /** Supply a pre-seeded client when a test needs specific cache contents. */
  queryClient?: QueryClient;
}

/**
 * Renders a component inside the same provider tree the app uses.
 *
 * Use this instead of RNTL's bare `render` for anything that touches the theme,
 * safe areas, or data fetching.
 *
 * REMINDER: RNTL v14's `render` is ASYNC, so callers must await this.
 */
export function renderWithProviders(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <SafeAreaProvider initialMetrics={TEST_SAFE_AREA_METRICS}>{children}</SafeAreaProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export { createTestQueryClient };
