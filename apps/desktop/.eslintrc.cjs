module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/explicit-function-return-type': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "VariableDeclarator[id.type='Identifier'][id.typeAnnotation=undefined]:not(ForOfStatement > VariableDeclaration > VariableDeclarator, ForInStatement > VariableDeclaration > VariableDeclarator, [init.type='ArrowFunctionExpression'], [init.type='FunctionExpression'], [init.type='TSSatisfiesExpression'])",
        message: 'Annotate the variable type; only a `satisfies` table derives its own.',
      },
      {
        selector:
          "PropertyDefinition[typeAnnotation=undefined]:not([value.type='ArrowFunctionExpression'], [value.type='FunctionExpression'])",
        message: 'Annotate the field type.',
      },
    ],
    'no-warning-comments': ['warn', { terms: ['xxx'], location: 'anywhere' }],
  },
};
