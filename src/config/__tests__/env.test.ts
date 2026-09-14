import { parseEnv, type EnvSource } from '@/config/env';

describe('parseEnv', () => {
  const validEnv: EnvSource = {
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  };

  it('returns a normalised config for a valid environment', () => {
    expect(parseEnv(validEnv)).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseAnonKey: 'anon-key',
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
});
