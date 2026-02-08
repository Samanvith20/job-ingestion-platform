import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig([
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    ignores: ['node_modules/**', 'dist/**', '*.log', '.env', '.env.*', 'pnpm-lock.yaml'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
      ecmaVersion: 2022,
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      'prefer-const': 'error',
    },
  },
  eslintConfigPrettier,
]);
