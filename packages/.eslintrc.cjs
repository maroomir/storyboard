const explicitTypeRules = require('../scripts/lint/explicitTypeRules.cjs');
const { functionSizeLimits, functionSizeExemption } = require('../scripts/lint/functionSizeRules.cjs');

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
    ...functionSizeLimits,
    'no-warning-comments': ['warn', { terms: ['xxx'], location: 'anywhere' }],
  },
  overrides: [
    {
      files: ['story-app/src/storyboardApplication.ts', 'story-app/src/resourceOverrides.ts'],
      rules: functionSizeExemption,
    },
  ],
};
