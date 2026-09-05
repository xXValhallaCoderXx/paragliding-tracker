const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  { ignores: ['dist/**', '.expo/**', 'supabase/**'] },
  { files: ['**/*.cjs'], languageOptions: { globals: { __dirname: 'readonly' } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/__tests__/**', 'src/cloud/database.types.ts'],
    plugins: { architecture: { rules: { boundaries: require('./scripts/eslint/architecture.cjs') } } },
    rules: { 'architecture/boundaries': 'error' },
  },
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
