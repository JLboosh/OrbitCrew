import { screen, userEvent } from '@testing-library/react-native';

import ProfileScreen from '../(tabs)/profile';

import { renderWithProviders } from '@/test-utils/render';

// The screen is tested in isolation from Supabase: these tests are about the
// privacy CONTROLS behaving correctly. That the database defaults are private is
// verified separately against the real database by scripts/verify-foundation.mjs.
const mockUpdatePrivacy = jest.fn();
const mockUpdateProfile = jest.fn();

let mockPrivacyData: Record<string, unknown> = {};

jest.mock('@/api', () => ({
  useMyProfile: () => ({
    data: {
      id: '11111111-1111-4111-8111-111111111111',
      display_name: 'Alex Rivera',
      username: 'alexrivera',
      timezone: 'America/Toronto',
      weight_unit: 'lb',
      avatar_url: null,
    },
  }),
  useMyPrivacySettings: () => ({ data: mockPrivacyData, isLoading: false }),
  useUpdatePrivacySettings: () => ({ mutate: mockUpdatePrivacy }),
  useUpdateProfile: () => ({ mutate: mockUpdateProfile, isPending: false }),
  // The identity card owns the picture controls; these tests are about the
  // privacy controls, so the mutations only need to exist.
  useUploadAvatar: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRemoveAvatar: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));

function renderScreen() {
  return renderWithProviders(<ProfileScreen />);
}

beforeEach(() => {
  mockPrivacyData = {
    presence_visibility: 'nobody',
    default_activity_detail: 'trained_only',
    share_progress_summary: false,
    discoverable_by_username: true,
    allow_motivation_spotlight: false,
    contribute_to_crowd_stats: false,
  };
});

describe('Profile / privacy screen', () => {
  it('shows the most private presence option as selected by default', async () => {
    await renderScreen();

    expect(screen.getByRole('button', { name: 'No one' })).toBeSelected();
  });

  it('shows the least revealing activity detail as selected by default', async () => {
    await renderScreen();

    expect(screen.getByRole('button', { name: 'That I trained' })).toBeSelected();
  });

  it('presents progress sharing and the spotlight as off', async () => {
    await renderScreen();

    expect(screen.getByRole('switch', { name: 'Share progress summaries' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Motivation Spotlight' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Help build crowd patterns' })).not.toBeChecked();
  });

  it('explains the consequence of each sharing control', async () => {
    await renderScreen();

    // A privacy toggle the member does not understand is not real consent, so
    // each one must carry a plain-language description.
    for (const label of [
      'Share progress summaries',
      'Findable by username',
      'Motivation Spotlight',
      'Help build crowd patterns',
    ]) {
      const row = screen.getByRole('switch', { name: label });
      expect(row.props.accessibilityHint?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('saves a new presence audience when one is chosen', async () => {
    await renderScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Friends' }));

    expect(mockUpdatePrivacy).toHaveBeenCalledWith(
      { presence_visibility: 'friends' },
      expect.anything(),
    );
  });

  it('saves a stricter activity detail level', async () => {
    await renderScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Plus the gym' }));

    expect(mockUpdatePrivacy).toHaveBeenCalledWith(
      { default_activity_detail: 'gym_name' },
      expect.anything(),
    );
  });

  it('toggles progress sharing on', async () => {
    await renderScreen();

    await userEvent.press(screen.getByRole('switch', { name: 'Share progress summaries' }));

    expect(mockUpdatePrivacy).toHaveBeenCalledWith(
      { share_progress_summary: true },
      expect.anything(),
    );
  });

  it('reflects an already-enabled setting rather than assuming defaults', async () => {
    mockPrivacyData = { ...mockPrivacyData, presence_visibility: 'all_crews' };
    await renderScreen();

    expect(screen.getByRole('button', { name: 'All my crews' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'No one' })).not.toBeSelected();
  });

  it('tells the member which timezone their times are shown in', async () => {
    await renderScreen();

    expect(screen.getByText(/America\/Toronto/)).toBeOnTheScreen();
  });
});
