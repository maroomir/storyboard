# Testing and Verification

Use project-defined scripts and keep verification appropriate to the current repository maturity.

## Before Running Commands

- Inspect `package.json` first.
- Prefer existing scripts over ad-hoc commands.
- Do not assume script names; VSCode extensions often use `compile` rather than `build`.

## Recommended Verification Layers

When available:

```bash
npm run compile
npm run lint
npm test
```

For webview-specific work, use webview-specific scripts if the repository defines them.

Run focused tests first for narrow changes. Broaden verification when shared behavior, message contracts, persistence, or extension lifecycle code changes.

Mock external APIs, subprocesses, Git repositories, and network access in unit tests by default.

## Extension Testing

- Test command registration and activation events.
- Test extension-host services without requiring a webview when possible.
- Use VSCode integration tests for behavior that depends on VSCode APIs.

## Webview Testing

- Keep message handling testable separately from visual rendering.
- Test loading, empty, error, and cancellation states.
- Avoid relying only on screenshots for logic verification.

## Manual Verification

If automated scripts do not exist yet, state that verification is limited and manually inspect:

- File paths and imports.
- `package.json` contribution consistency.
- Message contracts between extension host and webview.
- TypeScript syntax and obvious runtime issues.
