const unannotatedVariable =
  "VariableDeclarator[id.type='Identifier'][id.typeAnnotation=undefined]" +
  ':not(' +
  [
    'ForOfStatement > VariableDeclaration > VariableDeclarator',
    'ForInStatement > VariableDeclaration > VariableDeclarator',
    "[init.type='ArrowFunctionExpression']",
    "[init.type='FunctionExpression']",
    "[init.type='TSSatisfiesExpression']",
  ].join(', ') +
  ')';

const unannotatedField =
  'PropertyDefinition[typeAnnotation=undefined]' +
  ":not([value.type='ArrowFunctionExpression'], [value.type='FunctionExpression'])";

module.exports = {
  '@typescript-eslint/no-inferrable-types': 'off',
  '@typescript-eslint/explicit-function-return-type': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: unannotatedVariable,
      message: 'Annotate the variable type; only a `satisfies` table derives its own.',
    },
    { selector: unannotatedField, message: 'Annotate the field type.' },
  ],
};
