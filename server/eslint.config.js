const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**', 'cloud/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Unused args/vars prefixed with _ are intentional; the `catch {}` idiom
      // (commented) is used throughout, so don't flag unused catch bindings.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
];
