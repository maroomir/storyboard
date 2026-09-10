# AGENTS.md

This document gives AI coding agents the project-specific context needed to work effectively in `storyboard`.

## Project Identity

`storyboard` is intended to be a Visual Studio Code extension inspired by the architecture and development practices of Cline (`/Users/maroomir/Git/clien/cline`). Use Cline as a reference for patterns, but do not copy implementation details blindly.

## Current Status

The extension source is fully migrated into the layered structure below; the legacy `core/`, `files/`, `services/`, `commands/`, and `providers/` directories no longer exist. Existing source and tests are authoritative.

Keep changes incremental and preserve behavior.

## Source of Truth

Apply this priority when instructions conflict:

1. The user's latest explicit instruction.
2. Existing source files and tests.
3. `apps/vscode/package.json` for extension metadata, scripts, activation events, commands, views, menus, and configuration.
4. Tracked product and architecture documentation.
5. `.claude/rules/` and `AGENTS.md` for AI-agent working rules.
6. `CLAUDE.md` as the Claude Code rule index.

- `.claude/rules/agent-behavior.md` applies the Karpathy-inspired agent rules: surface assumptions, prefer simple solutions, make surgical changes, and define verifiable success criteria.
- `.claude/rules/architecture.md` defines layer boundaries and when object-oriented patterns are justified.
- `.claude/rules/clean-code.md` (and `.cursor/rules/clean-code.mdc`) define clean-code guidance for agents.
- `.claude/rules/coding-standards.md` (and `.cursor/rules/coding-standards.mdc`) define the monorepo-wide structure, naming, typing, and error-handling standards; the reference module is `apps/cli`, with `packages/story-format` as the package-side reference.
- `.claude/rules/comments.md` defines allowed comment markers (`TODO(<issue>)`, `FIXME(<issue>)`, `NOTE`, `SECURITY`) for TypeScript/TSX and **strongly prefers minimal comments** (add only when truly necessary); Cursor loads the same policy from `.cursor/rules/comments-policy.mdc`.

If documents conflict in a way that could change behavior, investigate and ask before editing.

## Core Principles

- This is a VSCode extension project.
- Check `apps/vscode/package.json` scripts before running build, lint, test, or packaging commands; the root `package.json` re-exports only `build`, `compile`, `lint`, `test`, and `package:vsix` to that workspace.
- When updating the project version or release notes, update both `apps/vscode/CHANGELOG.md` and `apps/vscode/CHANGELOG.en.md` in the same change. The extension version lives only in `apps/vscode/package.json`.
- Tracked docs at repo root: `ARCHITECTURE.md`, `RELEASE.md`. Extension-scoped docs live in `apps/vscode/`: `EXTENSION_QA.md`, `GUIDE.md`. Optional local-only `.doc/` (gitignored) for extended plans and ADRs.
- Inspect nearby files and existing conventions before editing.
- For non-trivial work, state assumptions and success criteria before editing; ask when ambiguity could change the implementation.
- Keep changes surgical: every changed line should trace directly to the user's request.
- Keep extension host code, shared domain code, and webview UI code separated.
- Use TypeScript and explicit types for extension messages, state, and command payloads.
- Prefer small, focused modules over large catch-all files.
- Follow the clean code rules in `.claude/rules/clean-code.md`: optimize for readability, maintainability, testability, and consistent naming/structure.
- Do not introduce secrets, API keys, or user-private values into source control.
- If you reference Cline, adapt the idea to `storyboard` rather than importing unrelated complexity.

## Import aliases

- **`@/`** → that app's own `src/` — defined per app in [`apps/vscode`](apps/vscode/tsconfig.json) and [`apps/cli`](apps/cli/tsconfig.json).
- **`@webview/`** → [`apps/vscode/webview-ui/src/`](apps/vscode/webview-ui/src/) (webview UI only). Do not use `@/` from webview code; keep the extension/webview boundary obvious.
- **`#engine/`, `#format/`, `#ai/`, `#git/`, `#pipeline/`** → each package's own `src/`, declared as Node subpath imports in that package's `package.json`. Packages must not use `@/`: apps bundle package source through one global alias table, so `@/` inside a package resolves to the *app's* `src/` with no error. A package must not use another package's prefix either.
- Any import that climbs out of its own folder uses the alias; `./sibling` is fine and `../` fails the architecture check.
- Aliases live in each project's `tsconfig.json`; [`scripts/aliases.mjs`](scripts/aliases.mjs) feeds the same table to esbuild, Vite, and Vitest, so no bundler config restates a path.

## Narration and Composition

시점은 `setting.pov`(5값: `first`, `first-retrospective`, `second`, `third-limited`,
`third-omniscient`) 하나로 시작하고, 이름 붙인 서술자가 필요해지면 `narrator/*.card`를 만든다.
카드는 인칭·지식 경계(`witnessed`/`omniscient`/`retrospective`)·시제·초점 인물·목소리를 갖는다.
해석은 **씬 카드 > `chapters.yaml`의 장 > 프로젝트 기본** 순이며, 아무것도 없으면 프롬프트에
시점 지시가 나가지 않는다(기존 작품의 결과가 달라지지 않게 하려는 의도).

구성(`setting.composition`)은 `linear` / `omnibus` / `alternating-pov` / `frame` 네 프리셋이고,
프리셋이 연속성 줄기(`setting.threads`)와 서술자 카드를 만든다. 줄기는 이야기 상태 원장·장
요약·직전 씬 맥락·페르소나/배경 기억의 스코프다 — 기본 줄기 `main`은 종전 경로를 쓰고 나머지는
`.storyboard/memory/threads/<id>/` 아래로 내려가며, **캐넌만 전역으로 공유**된다. 씬 번호는
전역으로 유지되고 원고 조립도 번호순이다.

지식 경계는 이야기 상태 원장의 항목마다 기록된 목격자(`- [12|hana,jun] …`)로 강제된다.
`witnessed` 서술자의 초점 인물이 목격자에 없으면 그 항목은 프롬프트에서 빠지고, 목격자가 없는
구 버전 항목은 판정할 수 없으므로 통과시킨다.

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

## Current Architecture

The repository is a private npm workspaces monorepo named `storyboard-monorepo`, with workspaces `apps/*` and `packages/*` and a single root `package-lock.json`. The VSCode extension is the `storyboard-vscode` workspace at `apps/vscode/`; the CLI `@storyboard/cli` lives at `apps/cli/`, and the shared packages are `packages/story-engine` (domain policies and shared contracts), `packages/story-format` (schemas/codecs/paths/fixtures), `packages/story-ai` (AI engine and ports), `packages/story-pipeline` (scene generation orchestration), and `packages/story-config` (the shared `~/.storyboard` home: config layers, secrets file, watchers). Packages expose TypeScript source; `apps/vscode/scripts/check-architecture.mjs` enforces that no package imports `vscode` or an app module, and each app's `scripts/check-architecture.mjs` enforces its own layer direction. The CLI is the reference implementation: `apps/cli/test/parity.test.ts` fails the build when the extension gains a command the CLI cannot run. CLI invariants live in `.claude/rules/cli.md`.

The extension host currently uses this transition shape:

```text
apps/vscode/                  # `storyboard-vscode` workspace: the VSCode extension
  package.json                 # Extension manifest, scripts, and version
  src/
    extension.ts               # Thin VS Code entry point
    bootstrap/                 # StoryboardApplication, lifecycle, feature modules
    application/               # Use cases, pipelines, ports, application-owned gateways
    infrastructure/            # VS Code and persistence port implementations
    presentation/              # Commands, providers, and webview messaging
    domain/                    # Runtime-agnostic policies and value types
    shared/                    # Wire contracts and runtime-agnostic values
  webview-ui/                  # Webview UI source
  test/                        # Vitest suites and fixtures
  scripts/                     # Build and architecture-check scripts
```

Dependency rules already enforced by `npm run check:architecture` (run from `apps/vscode`, or `npm run check:architecture --workspace storyboard-vscode` from the repo root):

- `extension.ts` imports only `bootstrap` (besides `vscode`).
- `shared` imports only itself.
- `domain` must not import `application`, `infrastructure`, `presentation`, `bootstrap`, or `vscode`.
- `application` must not import `vscode` at runtime.
- No import cycles anywhere in `src/`.
- Lifecycle-owned objects are created by `PlatformModule` or a feature module and disposed through `DisposableStore`.

Do not create a new abstraction solely to move a file. Use ports for genuine runtime boundaries such as file I/O, persistence, AI transport, or VS Code state.

## VSCode Extension Guidelines

- Command IDs should use the `storyboard.*` namespace.
- Contributions should be declared in `apps/vscode/package.json` and registered in extension activation code where required.
- Keep contributed commands, views, menus, configuration, and activation events aligned with runtime registration code.
- Always dispose VSCode resources through `context.subscriptions` or explicit disposables.
- Webviews must use CSP, nonces, and `webview.asWebviewUri(...)` for local assets.
- Webview code should communicate with the extension host via message passing, not direct VSCode API imports.

## Messaging and State

- Prefer explicit discriminated unions for messages, such as `{ type: "eventName", payload: ... }`.
- Keep extension-to-webview and webview-to-extension message types separate when it improves clarity.
- Validate messages at extension boundaries when payloads include user input, file paths, or external data.
- Treat the extension host as the source of truth for persisted state.
- Settings live in `~/.storyboard/config.json` (overridden by `<workspace>/.storyboard/config.json`) through `ConfigBridge` over `@storyboard/story-config`; the extension contributes no VSCode `configuration`.
- Use `context.workspaceState` for workspace-specific state.
- Credentials live in `~/.storyboard/secrets.json` (0600) through `SecretStore`, shared with the CLI.
- Avoid duplicating persistent state in webview storage unless there is a deliberate synchronization strategy.

## Security and Privacy

- Never commit API keys, tokens, credentials, or local machine-specific secrets.
- Do not log secrets or send them to the webview.
- Avoid hard-coding user-private absolute paths unless they are explicitly documented as local references, such as the Cline reference checkout.
- Use a strict Content Security Policy for webviews.
- Use nonces for scripts and avoid `unsafe-eval` unless a toolchain forces it and the tradeoff is documented.
- Sanitize or safely render user-provided Markdown/HTML.

## Implementation Workflow

### Pre-Work Checklist

- [ ] Is the task within the documented product scope?
- [ ] Are assumptions, tradeoffs, and success criteria explicit?
- [ ] Is the relevant domain identified: extension host, shared contracts, webview, tests, docs, or tooling?
- [ ] Have nearby files, scripts, and conventions been inspected?
- [ ] Are secrets, user input, file paths, subprocesses, or other risky boundaries involved?
- [ ] Are tests, documentation, or rule updates required?

### Post-Work Checklist

- [ ] The request is satisfied without unrelated refactors or cleanup.
- [ ] Tests were added or updated when behavior changed.
- [ ] Package contributions and runtime registrations are aligned.
- [ ] Disposables are registered or explicitly disposed.
- [ ] Message contracts are typed and validated where needed.
- [ ] Code follows `.claude/rules/clean-code.md`.
- [ ] Appropriate project scripts were run, or the verification limitation is stated.
- [ ] New commands, settings, configuration, or user-facing behavior are documented.
- [ ] Rule files were updated when architecture, workflow, security, testing, or reporting expectations changed.

## Clean Code Standard

Code should be easy for another person to understand quickly and modify safely.

- Prefer clear names that reveal role and intent.
- Keep related state, derived values, and behavior close together.
- Split large functions/classes when the meaningful unit no longer fits in one readable view.
- Use comments for intent, constraints, and tradeoffs; avoid comments that repeat implementation.
- Keep code testable by separating pure logic from VSCode API and webview runtime dependencies.

For the full agent-facing checklist, read `.claude/rules/clean-code.md`.

## Parameters and Tables

One owner per value. A number, name, or list that two places must agree on lives in exactly one
file; everything else derives from it.

- Tuning numbers a person adjusts go in a JSON data file beside a zod schema that documents each
  knob: `modelProfiles.json` (per model), `pipelineDefaults.json` (model-agnostic generation),
  `promptTuning.json` (per prompt).
- Identifiers and enums stay TypeScript `as const` so literal types survive — `providerCatalog`,
  `STORYBOARD_RELATIVE_PATHS`, `pointOfViewCatalog`, `commandCatalog`. Never move an enum to JSON.
- Generation knobs layer as user setting → model profile → pipeline default. Setting defaults and
  bounds belong to `storyboardSettingCatalog` alone.
- The webview reads the real tables through `@storyboard/story-engine/contracts`, never a copy.
- Where two homes cannot be merged (manifest versus code), a test must fail when they disagree.
- `apps/vscode/scripts/check-architecture.mjs` fails the build when an owned literal appears outside
  its owner file; add the pair to `OWNED_LITERALS` when you give a value a single home.

For the full standard, read `.claude/rules/coding-standards.md`.

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

These, plus `npm run build` and `npm run package:vsix`, run from the repo root and delegate to the `storyboard-vscode` workspace. Scripts that exist only in `apps/vscode/package.json` — `check:architecture`, `watch`, `build:webview`, `format`, `format:check:src` — must be run from `apps/vscode`, or as `npm run <script> --workspace storyboard-vscode` from the repo root.

If scripts do not exist yet, explain that verification is limited and inspect the files manually.

For webview-specific work, use webview-specific scripts if the repository defines them.

Run focused tests first for narrow changes, then broaden verification when shared behavior or cross-runtime contracts change.

## Commit Message Style

Write an English subject with a Korean four-label body using this format:

```text
type(topic): Subject

[Issue] N/A
[Problem] 증상
[Cause & Measure] 원인과 조치
[Checking Method] 검증 방법과 결과

Signed-off-by: Maroomir Yoon <maroomir@gmail.com>
```

- The subject is `type(topic): Subject`, is 50 characters or less, clearly describes the change, and has no trailing period. `(topic)` is optional.
- Keep one blank line between the subject and body.
- Keep all four labels in order and write `N/A` for a label the change does not support.
- Write the body in Korean, state only what the diff supports, and never invent a verification result.
- Allowed types: `feat`, `fix`, `docs`, `test`, `refactor`, `style`, and `chore`.
- End with the `Signed-off-by` trailer. Do not append a `Co-Authored-By` trailer.

## Pull Requests

- Use clear, scoped commits.
- If `.github/pull_request_template.md` exists, follow it exactly.
- Summarize user-facing behavior, implementation notes, and test results.
- Mention any verification limitations clearly.

## Rule Synchronization

- Rules live canonically in `.claude/rules/` (Claude Code is the main tool). Update them when architecture, security, testing, comments, release, or agent workflow policy changes.
- Keep the `.cursor/rules/` summary (Cursor) and this `AGENTS.md` (Codex) aligned with `.claude/rules/` when the same rule applies.
- Skills live canonically in `.claude/skills/` and are mirrored to `.cursor/skills/`.
- Update `AGENTS.md` when agent workflow, checklists, commit style, or final reporting changes.
- Update `CLAUDE.md` only when the `.claude/rules/` import index changes.
- Update product documentation when user-facing behavior or scope changes.

## Final Report Format

When work is complete, summarize:

- Changed files.
- Implemented behavior or documentation.
- Security or configuration notes when relevant.
- Verification commands and results, or why verification was limited.
- Whether rule documents were updated.
- Remaining TODOs or follow-up work.

Keep the report concise and specific.

## Related Rule Files

Additional rule files live under `.claude/rules/` and are referenced by `CLAUDE.md`.

Important rule files:

- `.claude/rules/general.md`
- `.claude/rules/agent-behavior.md`
- `.claude/rules/architecture.md`
- `.claude/rules/storyboard-overview.md`
- `.claude/rules/vscode-extension.md`
- `.claude/rules/webview.md`
- `.claude/rules/testing.md`
- `.claude/rules/clean-code.md`
- `.claude/rules/comments.md`
- `.claude/rules/release.md`
- `.claude/rules/agent-workflow.md`

When writing or reviewing code, always apply the clean code standards summarized in `.claude/rules/clean-code.md` and the comment markers in `.claude/rules/comments.md` when adding or editing comments.
