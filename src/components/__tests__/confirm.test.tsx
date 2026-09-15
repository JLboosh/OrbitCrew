import { screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { Button, Text, useConfirm } from '../ui';

import { renderWithProviders } from '@/test-utils/render';

/**
 * These guard the fix for a real bug: "End session" and "Sign out" did nothing on
 * web because `Alert.alert` is a no-op in react-native-web
 * (`static alert() {}`). ConfirmProvider replaces it with a real modal, so these
 * tests assert the promise actually resolves in both directions.
 */
function Harness() {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('none');

  return (
    <>
      <Button
        label="End session"
        onPress={async () => {
          const confirmed = await confirm({
            title: 'End session?',
            message: 'Your logged sets are already saved.',
            confirmLabel: 'End session',
            cancelLabel: 'Keep going',
          });
          setResult(confirmed ? 'confirmed' : 'cancelled');
        }}
      />
      <Text>{`result:${result}`}</Text>
    </>
  );
}

describe('ConfirmProvider', () => {
  it('is not visible until confirmation is requested', async () => {
    await renderWithProviders(<Harness />);

    expect(screen.queryByText('End session?')).not.toBeOnTheScreen();
  });

  it('shows the title and message when opened', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'End session' }));

    expect(screen.getByText('End session?')).toBeOnTheScreen();
    expect(screen.getByText('Your logged sets are already saved.')).toBeOnTheScreen();
  });

  it('resolves true when the affirmative action is pressed', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'End session' }));
    // The dialog's own button carries the same label, so target the last match.
    const buttons = screen.getAllByRole('button', { name: 'End session' });
    await userEvent.press(buttons[buttons.length - 1]!);

    expect(screen.getByText('result:confirmed')).toBeOnTheScreen();
  });

  it('resolves false when cancelled', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'End session' }));
    await userEvent.press(screen.getByRole('button', { name: 'Keep going' }));

    expect(screen.getByText('result:cancelled')).toBeOnTheScreen();
  });

  it('closes after a decision so it cannot block the screen', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'End session' }));
    await userEvent.press(screen.getByRole('button', { name: 'Keep going' }));

    expect(screen.queryByText('Your logged sets are already saved.')).not.toBeOnTheScreen();
  });

  it('uses a custom confirm label rather than a generic one', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'End session' }));

    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeOnTheScreen();
  });
});
