import { screen, userEvent } from '@testing-library/react-native';

import { DailyChallengeCard } from '@/components/challenges';
import { renderWithProviders } from '@/test-utils/render';

/**
 * The Daily Challenge card, which is the surface every member sees.
 *
 * Two behaviours matter most and are both asserted here:
 *
 *   1. PROGRESS IS REAL AND VISIBLE. The bar announces the actual counts, not a bare
 *      percentage, so a member can tell 0 of 1 from 1 of 1.
 *   2. A FAILURE IS AN ERROR STATE, NOT AN EMPTY CARD. If today's challenge cannot be
 *      created or read, the card says so and offers a retry. An empty card is
 *      indistinguishable from "you have no challenges", which is what sent members
 *      looking for a setting they had not got wrong.
 */

const mockUseDailyChallenge = jest.fn();
const mockRefetch = jest.fn();

jest.mock('@/api', () => ({
  useDailyChallenge: () => mockUseDailyChallenge(),
}));

function stateFor(overrides: { progress?: number; completed?: boolean } = {}) {
  const progress = overrides.progress ?? 0;
  const completed = overrides.completed ?? false;

  return {
    data: {
      today: {
        dayKey: '2026-09-17',
        challenge: { id: 'daily-1' },
        progress,
        target: 1,
        completed,
      },
      history: [],
      completedInWindow: completed ? 1 : 0,
      windowDays: 7,
      timezone: 'America/Toronto',
      timezoneHonoured: true,
      startsAt: '2026-09-17T04:00:00.000Z',
      endsAt: '2026-09-18T04:00:00.000Z',
      emoji: '🔥',
      name: 'Daily Challenge',
      description: 'Train once today. Resets tomorrow morning.',
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
  };
}

beforeEach(() => {
  mockRefetch.mockClear();
  mockUseDailyChallenge.mockReturnValue(stateFor());
});

describe('DailyChallengeCard', () => {
  it('announces today\u2019s progress with the real counts', async () => {
    await renderWithProviders(<DailyChallengeCard />);

    expect(screen.getByRole('progressbar', { name: "Today's progress" })).toHaveAccessibilityValue({
      min: 0,
      max: 1,
      now: 0,
      text: '0 of 1 session, 0 percent',
    });
  });

  it('offers a way to start training when the challenge is not done', async () => {
    const onStartWorkout = jest.fn();
    await renderWithProviders(<DailyChallengeCard onStartWorkout={onStartWorkout} />);

    await userEvent.press(screen.getByRole('button', { name: 'Start a workout' }));

    expect(onStartWorkout).toHaveBeenCalledTimes(1);
  });

  it('reports completion rather than still asking for a workout', async () => {
    mockUseDailyChallenge.mockReturnValue(stateFor({ progress: 1, completed: true }));

    await renderWithProviders(<DailyChallengeCard onStartWorkout={jest.fn()} />);

    expect(screen.getByText(/Challenge complete/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Start a workout' })).toBeNull();
  });

  it('shows an error state with a retry instead of a blank card', async () => {
    mockUseDailyChallenge.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: 'network request failed' },
      refetch: mockRefetch,
      isFetching: false,
    });

    await renderWithProviders(<DailyChallengeCard />);

    expect(screen.getByText(/did not load/)).toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('replaces database plumbing with something a member can act on', async () => {
    // `errorMessage` deliberately swaps RLS and constraint text for a written
    // fallback: accurate is not the same as useful.
    mockUseDailyChallenge.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: 'new row violates row-level security policy for table "challenges"' },
      refetch: mockRefetch,
      isFetching: false,
    });

    await renderWithProviders(<DailyChallengeCard />);

    expect(screen.queryByText(/row-level security/)).toBeNull();
    expect(screen.getByText(/could not reach the challenge/i)).toBeOnTheScreen();
  });

  it('does not claim an error while it is still loading', async () => {
    mockUseDailyChallenge.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isFetching: true,
    });

    await renderWithProviders(<DailyChallengeCard />);

    expect(screen.getByText(/Loading today/)).toBeOnTheScreen();
    expect(screen.queryByText(/did not load/)).toBeNull();
  });
});
