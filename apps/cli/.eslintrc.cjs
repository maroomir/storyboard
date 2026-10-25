module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/typedef': [
      'error',
      { variableDeclaration: true, memberVariableDeclaration: true, variableDeclarationIgnoreFunction: true },
    ],
    'no-warning-comments': ['warn', { terms: ['xxx'], location: 'anywhere' }],
  },
};
