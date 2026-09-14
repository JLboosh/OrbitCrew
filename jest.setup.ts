/**
 * Jest setup, executed before each test file.
 *
 * Provides a deterministic environment so unit tests never depend on a
 * developer's local `.env` or on network access.
 */

// The env module validates these at import time and throws if absent, so they
// must be set before any module under test imports `@/config/env`.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// AsyncStorage is a native module with no JS implementation under Jest.
// The library ships an official in-memory mock.
// `require` is used deliberately: jest.mock factories are hoisted above
// imports, so an ESM import would not be initialised in time.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
