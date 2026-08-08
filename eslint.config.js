import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      '.run/**',
      'docs/**',
      'eng.traineddata',
      'finapp.db*',
      // Legacy operational/debug scripts at the repo root (gitignored).
      'test-email.js',
      'test-matching.js',
      'check-db.js',
      'reprocess-receipts.js',
      'cleanup-cats.cjs',
      'encrypt-existing.mjs',
      'update-bank-names.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Escaping / and - inside regexes is harmless; fixing changes the literal
      // and risks altering behavior for zero benefit.
      'no-useless-escape': 'warn',
    },
  },
  {
    files: ['server/**/*.js', 'test/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'react/react-in-jsx-scope': 'off', // React 19 / automatic JSX transform
      'react/prop-types': 'off',
      // Only the ruleset referenced by existing disable directives is loaded;
      // the strict exhaustive-deps rule itself stays off to avoid churn.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];
