// jest-expo supplies the renderer matching this Expo/React version.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const { create, act } = require(require.resolve('react-test-renderer', {
  paths: [require.resolve('jest-expo/package.json')],
}));
