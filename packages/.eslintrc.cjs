const explicitTypeRules = require('../scripts/lint/explicitTypeRules.cjs');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    '@typescript-eslint/no-explicit-any': 'error',
    ...explicitTypeRules,
    'no-warning-comments': ['warn', { terms: ['xxx'], location: 'anywhere' }],
  },
  overrides: [
    {
      files: ['story-sim/**', 'story-engine/**', 'story-model/**'],
      rules: {
        'no-restricted-syntax': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
};
