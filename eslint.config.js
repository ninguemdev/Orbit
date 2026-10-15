import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'packages/database/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Domain packages stay independent from frameworks, database and apps.
    files: ['packages/{contracts,simulation,catalog}/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'phaser',
                'react',
                'react-dom',
                '@colyseus/*',
                'pg',
                'drizzle-orm',
                'drizzle-orm/*',
              ],
              message: 'Domain packages must not depend on frameworks or the database.',
            },
            {
              group: ['@orbit/database', '@orbit/server', '@orbit/web'],
              message: 'Shared packages must not import apps or the database.',
            },
          ],
        },
      ],
    },
  },
  {
    // The client never bundles database access or server modules.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@orbit/database',
                '@orbit/server',
                'pg',
                'drizzle-orm',
                'drizzle-orm/*',
                '@colyseus/core',
              ],
              message: 'The client must not import server or database code.',
            },
          ],
        },
      ],
    },
  },
);
