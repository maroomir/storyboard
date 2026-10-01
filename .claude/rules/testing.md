# Testing and Verification

Use project-defined scripts and keep verification appropriate to the current repository maturity.

## Before Running Commands

- Inspect `package.json` first. From the repo root, `build`/`lint`/`test` drive every app, `compile` and `package:vsix` are extension-only, and `check:architecture`, `cli:build`, `desktop:dev`, `desktop:package` and `version:sync` are the remaining root scripts. Everything else lives in an app's own manifest.
- Prefer existing scripts over ad-hoc commands.
- Do not assume script names; VSCode extensions often use `compile` rather than `build`.

## Recommended Verification Layers

When available, run these from the repo root:

```bash
npm run compile
npm run lint
npm test
```

For webview-specific work, use webview-specific scripts if the repository defines them; those live only in `apps/vscode/package.json`, so run them from `apps/vscode`.

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
- `apps/vscode/package.json` contribution consistency.
- Message contracts between extension host and webview.
- TypeScript syntax and obvious runtime issues.
