# AGENTS.md

This document gives AI coding agents the project-specific context needed to work effectively in `storyboard`.

## Project Identity

`storyboard` is intended to be a Visual Studio Code extension inspired by the architecture and development practices of Cline (`/Users/maroomir/Git/clien/cline`). Use Cline as a reference for patterns, but do not copy implementation details blindly.

## Current Status

This repository is in its initial stage. Treat architecture described here as the intended direction until concrete source files are added.

When source files are not present yet, do not assume implementation details. Scaffold incrementally and keep the first implementation smaller than Cline's mature architecture unless the user explicitly asks for more.

## Source of Truth

- `package.json` is the source of truth for extension metadata, scripts, activation events, commands, views, menus, and configuration once it exists.
- `CLAUDE.md` and `.clinerules/` are the source of truth for AI-agent working rules.
- `.clinerules/agent-behavior.md` applies the Karpathy-inspired agent rules: surface assumptions, prefer simple solutions, make surgical changes, and define verifiable success criteria.
- `CLEANCODE.md` contains the human-readable clean code guide; `.clinerules/clean-code.md` summarizes it for agents.
- `.clinerules/comments.md` defines allowed comment markers (`TODO`, `FIXME`, `HACK`, `NOTE`, `SECURITY`) for TypeScript/TSX and **strongly prefers minimal comments** (add only when truly necessary); Cursor loads the same policy from `.cursor/rules/comments-policy.mdc`.
- Existing source files and tests override intended architecture notes. If implementation and documentation disagree, investigate before editing.

## Core Principles

- This is a VSCode extension project.
- Check `package.json` scripts before running build, lint, test, or packaging commands.
- When updating the project version or release notes, update both `CHANGELOG.md` and `CHANGELOG.ko.md` in the same change.
- Inspect nearby files and existing conventions before editing.
- For non-trivial work, state assumptions and success criteria before editing; ask when ambiguity could change the implementation.
- Keep changes surgical: every changed line should trace directly to the user's request.
- Keep extension host code, shared domain code, and webview UI code separated.
- Use TypeScript and explicit types for extension messages, state, and command payloads.
- Prefer small, focused modules over large catch-all files.
- Follow the clean code rules in `.clinerules/clean-code.md`: optimize for readability, maintainability, testability, and consistent naming/structure.
- Do not introduce secrets, API keys, or user-private values into source control.
- If you reference Cline, adapt the idea to `storyboard` rather than importing unrelated complexity.

## Import aliases

- **`@/`** → repository [`src/`](src/) (extension host code and anything compiled into the extension bundle).
- **`@webview/`** → [`webview-ui/src/`](webview-ui/src/) (webview UI only). Do not use `@/` from webview code; keep the extension/webview boundary obvious.
- Prefer these aliases over long `../../` chains; short same-folder or single-level sibling imports (`./`, `../`) are fine when they stay readable.
- Aliases are wired in [`tsconfig.json`](tsconfig.json), [`webview-ui/tsconfig.json`](webview-ui/tsconfig.json), [`esbuild.config.mjs`](esbuild.config.mjs), [`vite.config.mjs`](vite.config.mjs), and [`vitest.config.mts`](vitest.config.mts).

## Domain Boundaries

Keep responsibilities separated by runtime and dependency direction.

### Extension Host

Owns:

- VSCode activation and lifecycle.
- Command registration and contribution wiring.
- Webview panel/view creation.
- VSCode state APIs: `globalState`, `workspaceState`, and `secrets`.
- File system access, workspace inspection, terminals, and external integrations.
- Long-running work and progress reporting.

### Shared Code

Owns:

- Message contracts between extension host and webview.
- Domain DTOs, settings/state interfaces, and validation helpers.
- Runtime-agnostic utilities that do not import `vscode` or browser-only APIs.

### Webview UI

Owns:

- Rendering and local UI interactions.
- Local transient UI state.
- Calling the typed message client to communicate with the extension host.

The webview must not import `vscode` directly. Use message passing through `acquireVsCodeApi()` wrappers or an equivalent typed client.

## Expected Architecture

Recommended initial shape:

```text
src/
  extension.ts              # VSCode extension entry point
  core/                     # Extension-host orchestration and services
  shared/                   # Shared message/state/domain types
webview-ui/                 # Webview frontend, if/when introduced
assets/                     # Extension icons and media
tests/                      # Unit/integration tests
```

Start with the smallest useful version of this structure. Add deeper layers only when there is a concrete feature or testability need.

## VSCode Extension Guidelines

- Command IDs should use the `storyboard.*` namespace.
- Contributions should be declared in `package.json` and registered in extension activation code where required.
- Keep contributed commands, views, menus, configuration, and activation events aligned with runtime registration code.
- Always dispose VSCode resources through `context.subscriptions` or explicit disposables.
- Webviews must use CSP, nonces, and `webview.asWebviewUri(...)` for local assets.
- Webview code should communicate with the extension host via message passing, not direct VSCode API imports.

## Messaging and State

- Prefer explicit discriminated unions for messages, such as `{ type: "eventName", payload: ... }`.
- Keep extension-to-webview and webview-to-extension message types separate when it improves clarity.
- Validate messages at extension boundaries when payloads include user input, file paths, or external data.
- Treat the extension host as the source of truth for persisted state.
- Use `context.globalState` for user-level settings shared across workspaces.
- Use `context.workspaceState` for workspace-specific state.
- Use `context.secrets` for credentials and sensitive tokens.
- Avoid duplicating persistent state in webview storage unless there is a deliberate synchronization strategy.

## Security and Privacy

- Never commit API keys, tokens, credentials, or local machine-specific secrets.
- Do not log secrets or send them to the webview.
- Avoid hard-coding user-private absolute paths unless they are explicitly documented as local references, such as the Cline reference checkout.
- Use a strict Content Security Policy for webviews.
- Use nonces for scripts and avoid `unsafe-eval` unless a toolchain forces it and the tradeoff is documented.
- Sanitize or safely render user-provided Markdown/HTML.

## Implementation Workflow

Before editing:

1. Identify the relevant domain: extension host, shared contracts, webview, tests, docs, or tooling.
2. Inspect existing files and scripts before introducing new patterns.
3. Prefer the smallest change that satisfies the user request.
4. Ask a clarifying question when product behavior, architecture, or verification expectations are ambiguous.

Before finalizing changes:

- Confirm package contributions and runtime registrations are aligned.
- Confirm disposables are registered or explicitly disposed.
- Confirm message contracts are typed and validated where needed.
- Confirm code follows `.clinerules/clean-code.md`.
- Run appropriate project scripts, or state why verification is limited.

## Clean Code Standard

Code should be easy for another person to understand quickly and modify safely.

- Prefer clear names that reveal role and intent.
- Keep related state, derived values, and behavior close together.
- Split large functions/classes when the meaningful unit no longer fits in one readable view.
- Use comments for intent, constraints, and tradeoffs; avoid comments that repeat implementation.
- Keep code testable by separating pure logic from VSCode API and webview runtime dependencies.

For the full agent-facing checklist, read `.clinerules/clean-code.md`.

## Reference Project Usage

When using `/Users/maroomir/Git/clien/cline` as a reference:

- Borrow patterns for extension lifecycle, state persistence, message passing, webview security, and testing strategy.
- Simplify patterns for this repository's current maturity.
- Do not copy Cline-specific providers, marketplace behavior, protobuf services, CLI/TUI logic, telemetry, release automation, or unrelated domains unless the user explicitly asks for them.
- Treat Cline as a source of ideas, not a dependency contract.

## Verification

When scripts exist, prefer the project-defined commands, for example:

```bash
npm run compile
npm run lint
npm test
```

If scripts do not exist yet, explain that verification is limited and inspect the files manually.

For webview-specific work, use webview-specific scripts if the repository defines them.

## Pull Requests

- Use clear, scoped commits.
- If `.github/pull_request_template.md` exists, follow it exactly.
- Summarize user-facing behavior, implementation notes, and test results.
- Mention any verification limitations clearly.

## Related Rule Files

Additional rule files live under `.clinerules/` and are referenced by `CLAUDE.md`.

Important rule files:

- `.clinerules/general.md`
- `.clinerules/agent-behavior.md`
- `.clinerules/storyboard-overview.md`
- `.clinerules/vscode-extension.md`
- `.clinerules/webview.md`
- `.clinerules/testing.md`
- `.clinerules/clean-code.md`
- `.clinerules/comments.md`
- `.clinerules/release.md`

When writing or reviewing code, always apply the clean code standards summarized in `.clinerules/clean-code.md` and the comment markers in `.clinerules/comments.md` when adding or editing comments.
