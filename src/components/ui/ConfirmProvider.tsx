import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';

import { useTheme } from '@/theme';

/**
 * WHY THIS EXISTS
 * ---------------
 * React Native's `Alert.alert()` is a NO-OP on web. react-native-web ships it as
 * literally `static alert() {}`, so any confirmation built on it silently does
 * nothing in a browser — which is exactly why "End session" and "Sign out"
 * appeared broken on localhost.
 *
 * This replaces it with a real themed modal that behaves identically on iOS,
 * Android, and web, and returns a promise so call sites read linearly.
 */

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the affirmative action. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the affirmative action as destructive. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(next);
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setOptions(null);
    // Guard against a double-settle if the backdrop and a button both fire.
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(result);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      <Modal
        visible={options !== null}
        transparent
        animationType="fade"
        // Android hardware back and web Escape both cancel.
        onRequestClose={() => settle(false)}
      >
        <Pressable
          style={[
            styles.backdrop,
            {
              // Heavier scrim in dark mode: a 45% veil that separates a white
              // sheet from a pale canvas barely registers against a near-black
              // one, leaving the modal looking unanchored.
              backgroundColor: theme.isDark ? 'rgba(4, 8, 6, 0.72)' : 'rgba(16, 24, 20, 0.45)',
            },
          ]}
          accessibilityLabel="Dismiss"
          onPress={() => settle(false)}
        >
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.xl,
                padding: theme.spacing.xl,
                gap: theme.spacing.md,
              },
            ]}
          >
            <Text variant="heading" heading>
              {options?.title ?? ''}
            </Text>
            {options?.message ? (
              <Text variant="body" tone="muted">
                {options.message}
              </Text>
            ) : null}

            <View style={[styles.actions, { gap: theme.spacing.sm }]}>
              <Button
                label={options?.cancelLabel ?? 'Cancel'}
                variant="ghost"
                onPress={() => settle(false)}
              />
              <Button
                label={options?.confirmLabel ?? 'Confirm'}
                variant={options?.destructive ? 'danger' : 'primary'}
                onPress={() => settle(true)}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async confirm function.
 *
 *   if (await confirm({ title: 'End session?' })) { ... }
 */
export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used inside a ConfirmProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
});
