const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    // supabase/ holds Deno edge functions and SQL. Neither is part of the app bundle,
    // and the Deno globals would otherwise trip no-undef.
    ignores: ['dist/*', '.expo/*', 'supabase/*'],
    rules: {
      'import/no-unresolved': [
        'error',
        {
          ignore: [
            '^@/recorder/(flight-repository|location-task|recorder-service)$',
            '^@/cloud/(supabase|auth-service|sync-engine)$',
          ],
        },
      ],
    },
  },
]);
