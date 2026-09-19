import type { ExpoConfig } from 'expo/config';

// Imported from JSON rather than a .ts module because Expo evaluates this file
// as CommonJS in Node, which cannot require TypeScript. See
// src/constants/branding.ts for the full rationale.
import branding from './branding.json';

/**
 * Sub-path the web build is served from, or '' for the domain root.
 *
 * Duplicated from `normaliseBasePath` in `src/config/env.ts` rather than imported:
 * Expo evaluates this file as CommonJS in Node, which cannot require TypeScript —
 * the same constraint that forces `branding.json` to be JSON. The two must agree,
 * so `src/config/__tests__/env.test.ts` pins the normalisation rules.
 */
function basePath(): string {
  const trimmed = (process.env.EXPO_PUBLIC_BASE_PATH ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/**
 * Expo app configuration.
 *
 * All naming/identity values come from `branding.json` so the app can be
 * renamed in exactly one place. Avoid adding literal name strings here.
 */
const config: ExpoConfig = {
  name: branding.displayName,
  slug: branding.slug,
  scheme: branding.scheme,
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',

  // `automatic` honours the device light/dark preference.
  userInterfaceStyle: 'automatic',

  ios: {
    supportsTablet: true,
    bundleIdentifier: branding.iosBundleIdentifier,
    infoPlist: {
      // Location is used ONLY to show nearby gyms and confirm a check-in.
      // We request when-in-use (never "always") because the product must never
      // collect passive or background location history.
      NSLocationWhenInUseUsageDescription:
        'Used to show gyms near you and confirm a gym check-in. Your location is never shared with other members and is never tracked in the background.',
    },
  },

  android: {
    package: branding.androidPackage,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    // Explicitly refuse background location. Documents intent and prevents a
    // transitive dependency from silently adding it to the merged manifest.
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
  },

  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
  },

  plugins: ['expo-router', 'expo-secure-store'],

  experiments: {
    typedRoutes: true,

    /**
     * Rewrites every emitted asset URL to sit under the sub-path.
     *
     * Only set when deploying somewhere that is not the domain root — GitHub Pages
     * for a project repo serves at `/<repo>/`. Left empty, Expo emits root-absolute
     * paths, which is correct for Netlify, Cloudflare Pages, Vercel, and `npm run
     * web`. An empty string is the documented "no base URL" value.
     */
    baseUrl: basePath(),
  },
};

export default config;
