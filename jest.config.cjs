const expo = require('jest-expo/jest-preset');
const [transformer, options] = expo.transform['\\.[jt]sx?$'];
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts'],
  sandboxInjectedGlobals: ['Math'],
  transform: {
    ...expo.transform,
    // Keep imports lazy while letting Jest's CommonJS mocks intercept headless SQLite loading.
    '\\.[jt]sx?$': [transformer, { ...options, plugins: ['@babel/plugin-transform-dynamic-import'] }],
  },
};
