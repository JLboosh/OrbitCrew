import { render, screen, userEvent } from '@testing-library/react-native';

import { Button, ProgressBar, SettingSwitch, Text } from '../ui';

import { ThemeProvider } from '@/theme';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('Text', () => {
  it('exposes a header role when `heading` is set', async () => {
    await renderWithTheme(<Text heading>Progress</Text>);

    expect(screen.getByRole('header', { name: 'Progress' })).toBeOnTheScreen();
  });
});

describe('Button', () => {
  it('is reachable by its accessible role and label', async () => {
    await renderWithTheme(<Button label="Check in" onPress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Check in' })).toBeOnTheScreen();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Check in" onPress={onPress} />);

    await userEvent.press(screen.getByRole('button', { name: 'Check in' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress while loading', async () => {
    const onPress = jest.fn();
    await renderWithTheme(<Button label="Saving" loading onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeDisabled();

    await userEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reports busy state to assistive technology while loading', async () => {
    await renderWithTheme(<Button label="Saving" loading onPress={() => {}} />);

    // RNTL v14 replaced `toHaveAccessibilityState` with these granular matchers.
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
  });
});

describe('ProgressBar', () => {
  it('announces real counts rather than only a percentage', async () => {
    await renderWithTheme(
      <ProgressBar label="Weekly goal" value={29} target={36} unit="sessions" />,
    );

    expect(screen.getByRole('progressbar', { name: 'Weekly goal' })).toHaveAccessibilityValue({
      min: 0,
      max: 36,
      now: 29,
      text: '29 of 36 sessions, 81 percent',
    });
  });

  it('clamps overachievement to 100 percent without breaking layout', async () => {
    await renderWithTheme(<ProgressBar label="Weekly goal" value={50} target={36} />);

    expect(screen.getByRole('progressbar', { name: 'Weekly goal' })).toHaveAccessibilityValue({
      min: 0,
      max: 36,
      now: 50,
      text: '50 of 36, 100 percent',
    });
  });

  it('survives a zero target instead of producing NaN', async () => {
    await renderWithTheme(<ProgressBar label="Empty goal" value={0} target={0} />);

    expect(screen.getByRole('progressbar', { name: 'Empty goal' })).toBeOnTheScreen();
  });
});

describe('SettingSwitch', () => {
  it('exposes its label, consequence, and checked state together', async () => {
    await renderWithTheme(
      <SettingSwitch
        label="Live presence"
        description="Let friends see you are checked in."
        value={false}
        onValueChange={() => {}}
      />,
    );

    const row = screen.getByRole('switch', { name: 'Live presence' });
    expect(row).toBeOnTheScreen();
    expect(row).not.toBeChecked();
  });
});
