import { z } from 'zod';

/**
 * Runtime-validated environment configuration.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reading `process.env.X` inline throughout the app produces `string |
 * undefined` everywhere and fails at an arbitrary later point with a confusing
 * error. Validating once at startup means a misconfigured environment fails
 * immediately with an actionable message, and the rest of the codebase gets
 * non-optional strings.
 *
 * IMPORTANT: only `EXPO_PUBLIC_*` variables are readable in app code. Expo
 * inlines them into the JS bundle at build time, so they are NOT secret and are
 * extractable from a shipped app. Never put a Supabase `service_role` key or
 * any other privileged secret here — those belong only in Edge Functions or
 * server-side environments.
 *
 * The Supabase anon key is safe to ship: it grants no authority on its own.
 * Row-level security is what actually protects user data.
 */

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, 'EXPO_PUBLIC_SUPABASE_URL is required')
    .url('EXPO_PUBLIC_SUPABASE_URL must be a valid URL, e.g. http://127.0.0.1:54321'),

  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'EXPO_PUBLIC_SUPABASE_ANON_KEY is required'),

  /**
   * Sub-path the web build is served from, for hosts that do not serve at the
   * domain root. Optional, and empty for every other target.
   *
   * GitHub Pages for a project repo serves at `https://<user>.github.io/<repo>/`,
   * so every absolute asset path the export emits (`/_expo/...`, `/favicon.ico`,
   * and the MapLibre worker) 404s without this. Netlify, Cloudflare Pages, Vercel,
   * and a local server all serve at the root and need it left unset.
   */
  EXPO_PUBLIC_BASE_PATH: z.string().optional(),
});

/**
 * Normalises a base path to either `''` or `/segment`, with no trailing slash.
 *
 * Accepts what a person would plausibly type — `gymCrew-app`, `/gymCrew-app`,
 * `/gymCrew-app/`, or `/` — because this value is set by hand in a CI secret or a
 * shell, and a stray slash producing `//_expo/...` is a broken deploy that builds
 * perfectly well.
 */
export function normaliseBasePath(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed === '' || trimmed === '/') return '';

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
}

/**
 * Shape of an environment source. Deliberately looser than
 * `NodeJS.ProcessEnv` so tests can pass small literal objects without needing
 * to satisfy required Node-specific keys such as `NODE_ENV`.
 */
export type EnvSource = Record<string, string | undefined>;

/**
 * Parses and validates the environment.
 *
 * Exported separately from the singleton so tests can exercise validation
 * behaviour with arbitrary input rather than the ambient process environment.
 */
export function parseEnv(source: EnvSource = process.env as EnvSource) {
  const result = envSchema.safeParse({
    EXPO_PUBLIC_SUPABASE_URL: source.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: source.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_BASE_PATH: source.EXPO_PUBLIC_BASE_PATH,
  });

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env and fill in the values. ' +
        'For local development run `npm run db:start` and use the printed API URL and anon key.',
    );
  }

  return {
    supabaseUrl: result.data.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: result.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    basePath: normaliseBasePath(result.data.EXPO_PUBLIC_BASE_PATH),
  };
}

export type Env = ReturnType<typeof parseEnv>;

/**
 * Validated environment, resolved once at module load.
 *
 * NOTE: `process.env.EXPO_PUBLIC_*` references must be written literally (not
 * via a dynamic key) for Expo's build-time inlining to replace them.
 */
export const env: Env = parseEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_BASE_PATH: process.env.EXPO_PUBLIC_BASE_PATH,
});
