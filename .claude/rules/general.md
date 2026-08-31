# General Development Rules

This file captures high-signal guidance for working on `storyboard`.

## When to Update These Rules

Suggest updates when:

- The user corrects an assumption about project architecture or workflow.
- A change requires touching files that were not obvious from the request.
- A non-obvious convention is discovered after investigation.
- A repeated mistake could be prevented by documenting a rule.
- The user explicitly asks to add project memory or agent instructions.

Avoid adding generic programming advice that can be inferred from standard TypeScript or VSCode extension practices.

## Project Assumptions

- `storyboard` is three apps over one engine: a VSCode extension, a Telegram bot, and a CLI. The CLI is the reference implementation.
- Cline is a reference project, not a dependency contract.
- The repository is currently minimal, so distinguish existing implementation from intended architecture.
- Prefer incremental scaffolding over copying Cline's full structure prematurely.

## Development Guidelines

- Before running verification commands, inspect `package.json` for available scripts. From the repo root, `build`, `lint`, and `test` fan out to **all three apps**; `compile` and `package:vsix` are extension-only; `version:sync` keeps every app on the root version.
- Run any other extension script (`check:architecture`, `format:check:src`, `watch`, `build:webview`, `format`) from `apps/desktop`, or as `npm run <script> --workspace storyboard-vscode`.
- Use `npm run compile` if the project defines it; do not assume `npm run build` exists.
- Keep extension host code separate from webview UI code.
- Keep shared message/state types in a shared module once source structure exists.
- Use explicit command and message names prefixed with `storyboard`.
- Apply the clean code standards in `.claude/rules/clean-code.md` when writing or reviewing code.
- Use import aliases: `@/` → `apps/desktop/src/` (extension host), `@webview/` → `apps/desktop/webview-ui/src/` (webview). Prefer them over long `../../` chains; do not use `@/` from webview code.
- Do not commit generated build output unless the packaging workflow requires it.
- Do not store API keys, tokens, or personal workspace paths in committed code.

## Documentation Sync

- Update `apps/desktop/README.md` and related docs for new commands, settings, configuration, or user-facing behavior.
- Update tracked architecture documents when product scope, file formats, or runtime boundaries change.
- Rules live canonically in the repo-root `.claude/rules/` (Claude Code is the main tool). When agent policy changes, update `.claude/rules/` and mirror it to the repo-root `.cursor/rules/` (Cursor) and `AGENTS.md` (Codex).
- Skills live canonically in the repo-root `.claude/skills/` and are mirrored to `.cursor/skills/`.
- Update the repo-root `CLAUDE.md` only when the `.claude/rules/` import index changes.

## Release

For version bumps, changelog cuts, VSIX packaging, and tags, see **`.claude/rules/release.md`** (and the `prepare-release` skill).

## Reference Project Usage

When using `/Users/maroomir/Git/clien/cline` as reference:

- Look for architectural patterns, lifecycle handling, message passing, and testing strategy.
- Avoid importing unrelated domains such as Cline-specific providers, protobuf services, marketplace features, or CLI logic unless the user asks for them.
- Simplify patterns for this repository's current maturity.
