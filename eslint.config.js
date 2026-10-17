import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'tests/screenshots/**',
      'frontend/public/**',
      'frontend/dev-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: [
      '*.config.{js,ts,cjs}',
      'frontend/*.config.ts',
      'frontend/vite.config.ts',
      'scripts/**',
      'frontend/src/core/fixtures/*.mjs',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
);
