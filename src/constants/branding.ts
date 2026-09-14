import brandingJson from '../../branding.json';

/**
 * APP IDENTITY
 * ============
 *
 * The raw values live in `branding.json` at the project root. To rebrand the
 * app, edit `displayName` there and nothing else — it flows into the native app
 * name, the splash screen, and all in-app copy.
 *
 * WHY JSON RATHER THAN A .ts FILE
 * -------------------------------
 * `app.config.ts` is transpiled and evaluated as CommonJS by Node, which cannot
 * `require` a TypeScript module. JSON is the one format both the Expo config
 * loader and the app's TypeScript code can read, which keeps this a genuine
 * single source of truth instead of two copies that drift apart.
 *
 * DO NOT hardcode the app name anywhere else. Import `BRANDING.displayName`.
 *
 * ---------------------------------------------------------------------------
 * WARNING: `iosBundleIdentifier` and `androidPackage` are PERMANENT once the
 * app is submitted to the App Store or Play Store. They are deliberately NOT
 * derived from `displayName` so that a rebrand never forces a store migration.
 * Change them freely before first submission; never after.
 * ---------------------------------------------------------------------------
 */
export interface Branding {
  /** Shown to users: home screen label, headers, onboarding copy. */
  readonly displayName: string;
  /** Short value proposition, used on the sign-in screen. */
  readonly tagline: string;
  /** Expo project slug. Stable identifier for EAS builds. */
  readonly slug: string;
  /** Deep-link scheme, e.g. `gymcrew://crew/invite/AB12CD`. */
  readonly scheme: string;
  /** PERMANENT after first App Store submission. */
  readonly iosBundleIdentifier: string;
  /** PERMANENT after first Play Store submission. */
  readonly androidPackage: string;
}

export const BRANDING: Branding = brandingJson;
