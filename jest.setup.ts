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

/**
 * Mock the icon set.
 *
 * `@expo/vector-icons` pulls in `expo-font` -> `expo-asset`, and `expo-asset` is
 * NOT hoisted to the project root (it lives under `node_modules/expo/`). Metro
 * resolves it through Expo's own dependency tree, but Jest's resolver cannot,
 * so importing any icon would fail every component test.
 *
 * Icons are decorative and carry no behaviour worth asserting, so a lightweight
 * stand-in is the right trade. It preserves `accessibilityLabel` handling in case
 * a test ever needs to find one.
 */
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');

  const makeIcon = (family: string) => {
    const Icon = (props: { name?: string; accessibilityLabel?: string }) =>
      React.createElement(View, {
        ...props,
        // Mirrors the real component: icons are hidden from assistive tech
        // unless explicitly labelled.
        accessibilityElementsHidden: !props.accessibilityLabel,
        testID: props.accessibilityLabel ? undefined : `icon-${family}-${props.name ?? 'unknown'}`,
      });
    // Consumers reference `Ionicons.glyphMap` for typing only, but provide it so
    // any runtime lookup does not explode.
    Icon.glyphMap = {};
    return Icon;
  };

  return {
    Ionicons: makeIcon('ionicons'),
    MaterialIcons: makeIcon('material'),
    MaterialCommunityIcons: makeIcon('material-community'),
    FontAwesome: makeIcon('fontawesome'),
    Feather: makeIcon('feather'),
    AntDesign: makeIcon('antdesign'),
  };
});
