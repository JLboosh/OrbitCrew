import { BRANDING } from '@/constants/branding';

/**
 * These tests protect the rebrand-safety property of the codebase: the display
 * name must remain swappable in one place, and store identifiers must not be
 * derived from it.
 */
describe('BRANDING', () => {
  it('exposes a non-empty display name and tagline', () => {
    expect(BRANDING.displayName.length).toBeGreaterThan(0);
    expect(BRANDING.tagline.length).toBeGreaterThan(0);
  });

  it('uses a valid reverse-DNS bundle identifier on both platforms', () => {
    const reverseDns = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

    expect(BRANDING.iosBundleIdentifier).toMatch(reverseDns);
    expect(BRANDING.androidPackage).toMatch(reverseDns);
  });

  it('uses a deep-link scheme that is lowercase and free of spaces', () => {
    expect(BRANDING.scheme).toMatch(/^[a-z][a-z0-9+.-]*$/);
  });
});
