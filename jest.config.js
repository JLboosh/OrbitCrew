/**
 * Jest configuration.
 *
 * Uses the `jest-expo` preset so tests run against the same module resolution
 * and transforms as the app itself.
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  // Mirrors the `@/*` -> `src/*` alias declared in tsconfig.json.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // React Native ships untranspiled ESM, so node_modules must NOT be blanket
  // ignored. This allowlist is the jest-expo recommended pattern.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|@tanstack/.*))',
  ],

  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/types/database.types.ts',
    '!src/**/__tests__/**',
  ],

  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(test).ts?(x)'],

  clearMocks: true,
};
