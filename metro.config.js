// Metro configuration. Before NativeWind this project was zero-config and Expo injected
// its defaults implicitly; adding this file makes them explicit. `getDefaultConfig` now runs
// twice (once here, once inside Expo's own loader, which merges this on top) — harmless, but
// expect the extra work at startup.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = withNativewind(config, {
  // `setupTypeScript` writes nativewind-env.d.ts and pushes it into tsconfig's `include`
  // whenever Metro config is evaluated. The file is committed and tsconfig's `**/*.ts`
  // already matches it, so the only effect would be a repeated gratuitous tsconfig edit.
  disableTypeScriptGeneration: true,
});
