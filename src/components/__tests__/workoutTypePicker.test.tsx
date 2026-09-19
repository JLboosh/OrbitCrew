import { screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { WorkoutTypePicker } from '@/components/workouts';
import { renderWithProviders } from '@/test-utils/render';
import { MAX_WORKOUT_CATEGORIES, type WorkoutCategoryKey } from '@/lib/workoutTypes';

/**
 * The first step of the workout flow.
 *
 * The selection rules are not obvious from the markup, so they are pinned here:
 * multi-select for real splits, Full Body as a replacement rather than an addition,
 * and a cap that matches the database CHECK constraint.
 */

/** Drives the picker the way the screen does, so selection is real state. */
function Harness({ initial = [] }: { initial?: WorkoutCategoryKey[] }) {
  const [selected, setSelected] = useState<WorkoutCategoryKey[]>(initial);
  return <WorkoutTypePicker selected={selected} onChange={setSelected} />;
}

describe('WorkoutTypePicker', () => {
  it('offers every primary training day as a labelled tile', async () => {
    await renderWithProviders(<Harness />);

    for (const label of [
      'Legs',
      'Arms',
      'Chest',
      'Back',
      'Core',
      'Shoulders',
      'Cardio',
      'Full Body',
    ]) {
      expect(screen.getByRole('checkbox', { name: label })).toBeOnTheScreen();
    }
  });

  it('exposes tiles as checkboxes, so a screen reader does not call a multi-select single-select', async () => {
    await renderWithProviders(<Harness />);

    expect(screen.getByRole('checkbox', { name: 'Chest' })).not.toBeChecked();
  });

  it('selects a training day', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Legs' }));

    expect(screen.getByRole('checkbox', { name: 'Legs' })).toBeChecked();
    // Twice: once on the tile, once in the readback card that shows the exact
    // wording the workout will be saved and listed under.
    expect(screen.getAllByText('Legs')).toHaveLength(2);
  });

  it('deselects on a second press', async () => {
    await renderWithProviders(<Harness initial={['legs']} />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Legs' }));

    expect(screen.getByRole('checkbox', { name: 'Legs' })).not.toBeChecked();
  });

  it('combines two days and reads the combination back', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Chest' }));
    await userEvent.press(screen.getByRole('checkbox', { name: 'Arms' }));

    expect(screen.getByText('Chest + Arms')).toBeOnTheScreen();
  });

  it('reaches the exact split people ask for through the finer muscle groups', async () => {
    await renderWithProviders(<Harness />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Chest' }));
    // Folded away by default so the first screen stays a glanceable grid.
    await userEvent.press(screen.getByRole('button', { name: 'Show individual muscle groups' }));
    await userEvent.press(screen.getByRole('checkbox', { name: 'Triceps' }));

    expect(screen.getByText('Chest + Triceps')).toBeOnTheScreen();
  });

  it('treats Full Body as a replacement, not an addition', async () => {
    // Full Body means "do not filter", so combining it with a specific muscle group
    // would be self-contradictory.
    await renderWithProviders(<Harness initial={['chest', 'back']} />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Full Body' }));

    expect(screen.getByRole('checkbox', { name: 'Full Body' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chest' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Back' })).not.toBeChecked();
  });

  it('replaces Full Body when a specific day is chosen afterwards', async () => {
    await renderWithProviders(<Harness initial={['full_body']} />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Legs' }));

    expect(screen.getByRole('checkbox', { name: 'Legs' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Full Body' })).not.toBeChecked();
  });

  it('stops at the cap the database allows, and says so', async () => {
    await renderWithProviders(<Harness initial={['chest', 'back', 'legs', 'core']} />);

    expect(screen.getByRole('checkbox', { name: 'Shoulders' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`maximum of ${MAX_WORKOUT_CATEGORIES}`))).toBeOnTheScreen();
  });

  it('still allows swapping one out at the cap', async () => {
    await renderWithProviders(<Harness initial={['chest', 'back', 'legs', 'core']} />);

    await userEvent.press(screen.getByRole('checkbox', { name: 'Core' }));

    expect(screen.getByRole('checkbox', { name: 'Shoulders' })).not.toBeDisabled();
  });

  it('prompts rather than leaving an unexplained disabled state', async () => {
    await renderWithProviders(<Harness />);

    expect(screen.getByText(/Pick at least one/)).toBeOnTheScreen();
  });
});
