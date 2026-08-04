import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // Uppercase-named args are React components passed as props (e.g. Section, Field).
      // ESLint can't see JSX usage without eslint-plugin-react, so mirror varsIgnorePattern
      // on args to avoid false "unused" reports that invite breaking removals.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^[A-Z_]', ignoreRestSiblings: true }],
      // eslint-plugin-react-hooks v7 promotes the React Compiler lint rules to
      // errors in its recommended config. This codebase doesn't adopt the React
      // Compiler, and these flag intentional, correct patterns (the latest-ref
      // `xxxRef.current = prop` idiom, manual useMemo, deliberate setState in an
      // effect). Keep them as warnings so they stay visible without failing CI.
      // rules-of-hooks stays an error — those are genuine bugs.
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      // Fast-Refresh DX hint (a file exporting constants next to a component) —
      // not a correctness issue; warn instead of blocking the build.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
