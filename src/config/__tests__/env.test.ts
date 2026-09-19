import { normaliseBasePath, parseEnv, type EnvSource } from '@/config/env';

describe('parseEnv', () => {
  const validEnv: EnvSource = {
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  };

  it('returns a normalised config for a valid environment', () => {
    expect(parseEnv(validEnv)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'anon-key',
      basePath: '',
    });
  });

  it('throws an actionable error when the URL is missing', () => {
    const env: EnvSource = { ...validEnv, EXPO_PUBLIC_SUPABASE_URL: undefined };

    expect(() => parseEnv(env)).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
    expect(() => parseEnv(env)).toThrow(/\.env\.example/);
  });

  it('rejects a malformed URL rather than failing later at request time', () => {
    expect(() => parseEnv({ ...validEnv, EXPO_PUBLIC_SUPABASE_URL: 'not-a-url' })).toThrow(
      /valid URL/,
    );
  });

  it('throws when the anon key is an empty string', () => {
    expect(() => parseEnv({ ...validEnv, EXPO_PUBLIC_SUPABASE_ANON_KEY: '' })).toThrow(
      /EXPO_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it('treats a missing base path as root, which is what every host but Pages wants', () => {
    expect(parseEnv(validEnv).basePath).toBe('');
  });

  it('reads a configured base path', () => {
    expect(parseEnv({ ...validEnv, EXPO_PUBLIC_BASE_PATH: '/gymCrew-app' }).basePath).toBe(
      '/gymCrew-app',
    );
  });
});

/**
 * A stray slash here does not fail the build — it produces `//_expo/...` and a
 * site that loads nothing, which is a far worse failure than an error. The value
 * is typed by hand into a CI secret, so it is worth being forgiving about.
 */
describe('normaliseBasePath', () => {
  it('returns empty for nothing, blank, or a bare root', () => {
    expect(normaliseBasePath(undefined)).toBe('');
    expect(normaliseBasePath('')).toBe('');
    expect(normaliseBasePath('   ')).toBe('');
    expect(normaliseBasePath('/')).toBe('');
  });

  it('adds a missing leading slash', () => {
    expect(normaliseBasePath('gymCrew-app')).toBe('/gymCrew-app');
  });

  it('strips a trailing slash', () => {
    expect(normaliseBasePath('/gymCrew-app/')).toBe('/gymCrew-app');
    expect(normaliseBasePath('gymCrew-app/')).toBe('/gymCrew-app');
  });

  it('leaves an already-correct value alone', () => {
    expect(normaliseBasePath('/gymCrew-app')).toBe('/gymCrew-app');
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    expect(normaliseBasePath('  /gymCrew-app  ')).toBe('/gymCrew-app');
  });
});
