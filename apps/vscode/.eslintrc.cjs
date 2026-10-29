const explicitTypeRules = require("../../scripts/lint/explicitTypeRules.cjs");
const { functionSizeLimits, functionSizeExemption } = require("../../scripts/lint/functionSizeRules.cjs");

module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["out", "dist", "node_modules"],
  rules: {
    ...explicitTypeRules,
    ...functionSizeLimits,
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
    "no-warning-comments": [
      "warn",
      {
        terms: ["xxx"],
        location: "anywhere"
      }
    ]
  },
  overrides: [
    {
      files: ["test/**", "scripts/**", "*.config.ts", "*.config.mts"],
      rules: { "no-restricted-syntax": "off", ...functionSizeExemption }
    },
    {
      files: ["**/*.tsx", "src/bootstrap/modules/*.ts"],
      rules: functionSizeExemption
    }
  ]
}
