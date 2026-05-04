/**
 * Comment policy: minimize comments—prefer names/types; add only what is truly necessary.
 * When needed, use TODO, FIXME, HACK, NOTE, or SECURITY for intentional markers only.
 * Preserve TypeScript directives (/// <reference), @ts-expect-error / @ts-ignore, and eslint-disable* when required.
 */
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
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "no-warning-comments": [
      "warn",
      {
        terms: ["xxx"],
        location: "anywhere"
      }
    ]
  }
}