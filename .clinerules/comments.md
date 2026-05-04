# Comments (TypeScript / TSX)

Applies to `src/`, `webview-ui/src/`, and `test/` unless a task says otherwise.

## Project preference: minimal comments

- **Default: add no new comments.** This project strongly prefers almost no comments—only what is truly necessary.
- Do not add explanatory narration, decorative section comments, or JSDoc that duplicates types or good names.
- If code is hard to follow, prefer **refactors (names, structure, types)** over comments.
- When unsure, **leave the comment out**.

## Default

- Prefer clear names and explicit types over comments.
- Do not add comments that only repeat what the code already expresses.

## When to add a comment

Only when skipping it would likely mislead someone or hide a real constraint (e.g. security, host ↔ webview contract, temporary hack). Keep to intent, constraints, or tradeoffs that the code cannot express. Prefer one tagged line (`// NOTE: …`, etc.).

## Allowed markers

Prefix line comments with one of:

- `TODO` — planned work or known gap
- `FIXME` — wrong or incomplete behavior to fix
- `HACK` — intentional temporary workaround (brief why)
- `NOTE` — non-obvious contract, coupling, or cross-boundary behavior (e.g. host ↔ webview messaging)
- `SECURITY` — trust boundaries, CSP, secrets, paths; never suggest logging secrets

Example: `// NOTE: Payload shape matches settings.read response.`

## Do not remove

- TypeScript directives such as `/// <reference types="…" />`
- `@ts-expect-error` / `@ts-ignore` and compiler-required explanations
- `eslint-disable*` comments when they are still needed; keep the narrowest scope

## ESLint

See the header comment in `.eslintrc.cjs` for the same policy. `no-warning-comments` is configured to warn on ambiguous `xxx`-style markers.

## Webview and security

Use `NOTE` or `SECURITY` for CSP, nonces, `asWebviewUri`, and validation at the extension boundary.
