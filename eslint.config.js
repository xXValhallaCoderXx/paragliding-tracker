const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
    rules: {
      'import/no-unresolved': [
        'error',
        { ignore: ['^@/recorder/(location-task|recorder-service)$'] },
      ],
    },
  },
]);
