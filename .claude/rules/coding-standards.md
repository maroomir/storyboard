# Monorepo Coding Standards

Cross-cutting standards for how the apps and the shared packages are structured, named, and
typed. The reference module is **`apps/cli`** — its rules are enforced end to end by its own
architecture check; on the package side, **`packages/story-format`** is the reference
for schema-first types and the error-class template. Generic readability and verb rules live in
`.claude/rules/clean-code.md`; this file covers only what is monorepo-specific.

## Directory and File Structure

- Apps are ordered one-way layer stacks enforced by each app's `scripts/check-architecture.mjs`.
  The CLI's single `LAYER_ORDER` line (`adapters → commands → tui`) is the model: every source file
  lives in exactly one layer, and a layer imports only itself and layers to its left.
- The engine's object graph is built once, for every app, by `StoryboardApplication` in
  `packages/story-app`. Each app keeps one thin root of its own — `createCliContainer()` (cli),
  `createDesktopContainer()` (desktop), `PlatformModule.initialize()` (vscode) — that builds only
  its host adapters and hands them in. Do not construct engine use cases anywhere else — and do not
  construct ones no command or handler calls.
- A package's public contract is its `index.ts` only; deep imports into `src/` are not part of the
  contract. Inside a package, organize by role — `story-ai`'s `ai/` (services), `contracts/`
  (DTOs), `ports/` (host adapters) split is the model.
- Packages ship TypeScript source (no build); every app must resolve `@storyboard/*` identically in
  tsconfig `paths`, esbuild `alias`, and vitest `alias` — keep all three in sync when adding a
  package.
- Tests belong to the apps (packages have no runners). The CLI uses flat `test/*.test.ts`; vscode
  uses `test/unit/**/*.spec.ts(x)` mirroring layers. A new app follows the CLI's shape. Git tests
  run against real repositories in a temp directory — never replace them with stubs.

## Naming

- **Files are camelCase, including class modules** (`jobManager.ts` → `class JobManager`). Never
  kebab-case. Existing PascalCase files in `apps/vscode` and `packages/story-ai` stay as they are —
  no batch renames — but new files are camelCase.
- Acronyms in identifiers capitalize the first letter only: `Ai`, not `AI` (`AiProviderId`,
  `OpenAiProvider`).
- Interfaces split by kind: **substitutable ports/contracts take the `I` prefix**
  (`ICommandHandler`, `IFileSystem`, `IDraftRepository`); **DTOs/records are unprefixed
  `interface` with every field `readonly`**. A structural stand-in for a host type takes the
  `...Like` suffix (`StoryboardConfigurationLike`) — the shape without the import.
- Injection names: dependency bags are `XDependencies`, request/result pairs `XRequest`/`XResult`,
  zod schemas camelCase `xSchema`. Handler factories are `createXHandler`; vscode command
  registration is `registerXCommand`.
- Command surfaces: vscode `storyboard.<noun>.<verb>`, CLI `<noun> <verb>`, RPC methods dotted
  `noun.verb` (`cards.list`).

## Interfaces and Data Definitions

- **Schema-first at boundaries**: config files, RPC payloads, and workspace files (`.card` etc.)
  are defined by zod schemas; types derive via `z.infer`, unions via `z.discriminatedUnion`.
- `interface` = record shape (all fields `readonly`); `type` = union/alias. State machines are
  string-literal unions (`SyncState = 'clean' | 'no-remote' | …`); events and outcomes are
  discriminated unions on `kind`/`status`/`ok`.
- **Ports are structural and host-ignorant**: never name a host type — use `uri: unknown`,
  `PromiseLike`, or a hand-rolled `{ readonly dispose: () => void }`. Package code never imports
  `vscode`, even type-only (`import('vscode').X` in a type position counts as a violation).
- Dependency injection is constructor + a single `readonly` deps interface
  (`GenerateDraftUseCaseDependencies` pattern). Declare a port next to its consumer (in the
  use-case file or the package's `ports/`), but pick one convention per package.

## Error Handling and State

- **Two channels, never mixed ad hoc**:
  1. Expected failures the caller acts on are **returned** as discriminated unions —
     `{ ok: false, kind: 'failed' | 'cancelled', message }` (`GenerateDraftResult` pattern).
  2. Programmer/config errors are **thrown** as custom errors following the story-format template:
     `class XError extends Error` with a `code` string-literal union, optional `cause`, and
     `this.name` set. Codes are English kebab-case; messages are Korean.
- Catch-alls live only at the outermost isolation ring (the CLI's `index.ts`: log to stderr, set
  the exit code). A deliberately swallowed side-effect failure carries a comment
  saying why (usageSink: accounting must never fail a paid generation). No silent mid-layer
  catches — a corrupt config file must fail loudly as a typed `ConfigError`, never fall back to
  `{}`.
- Prefer explicit refusal over silent fallback: an unknown provider is rejected pre-flight, not
  downgraded to `mock` (which would overwrite a real draft and still exit 0).
- Process contract (cli): exit 0/non-0 is the API; stdout carries only the result, progress and
  warnings go to stderr.
- State: story content lives in the git workspace only. Engine settings live in the shared
  `~/.storyboard/config.json` (overridden by `<workspace>/.storyboard/config.json`) and API keys in
  `~/.storyboard/secrets.json` at 0600, both via `@storyboard/story-config` and honoring
  `STORYBOARD_HOME` (with tilde expansion). App-operational state that only one app needs
  lives under `~/.storyboard/<app>.json`. The extension contributes no
  VSCode `configuration` and uses neither `globalState` nor `context.secrets` as a store.

## Parameters and Tables

The rule is one owner per value. A number, a name, or a list that two places must agree on lives in
exactly one file; everything else derives from it.

- **Where a value lives**: tuning numbers a person adjusts go in a JSON data file next to a zod
  schema that documents each knob — the `*.params.json` files listed in **The parameter map** below
  are the models to copy.
  Identifiers and enums stay TypeScript `as const` so the literal types survive — `providerCatalog`,
  `STORYBOARD_RELATIVE_PATHS`, `pointOfViewCatalog`, `commandCatalog`. JSON loses literal types, so
  never move an enum into one.
- **The layering for generation knobs** is user setting → model profile → pipeline default. A value
  that only one model needs belongs in the model profile, never in the shared default.
- **Setting defaults and bounds** belong to `storyboardSettingCatalog` alone. Read them through
  `booleanSettingDefault` / `integerSettingDefault` / `clampIntegerSetting`; never restate a default
  or a `Math.min`/`Math.max` bound at a call site.
- **Record why a measured value is what it is** next to the value, as `modelProfiles.params.json` does with
  its `measured` block. A number with no provenance cannot be re-tuned.
- **The webview reads the real tables**, not copies: `@storyboard/story-engine/contracts` re-exports
  the browser-safe catalogs through `packages/story-engine/src/shared/catalogs.ts`. Add a re-export
  there rather than a second declaration under `webview-ui`.
- **Two homes that cannot be merged** (`package.json` contributions versus code constants, or the
  webview security allowlist) get a test that fails when they disagree — see
  `apps/vscode/test/unit/presentation/manifest.spec.ts`.
- **`apps/vscode/scripts/check-architecture.mjs` fails the build** when a literal appears outside the
  file that owns it. Add the pair to `OWNED_LITERALS` when you give a value a single home.
- **Browser-safe entry points**: a package barrel may export node-only modules, so anything the
  webview bundle reaches value-first must come from the narrow entry — `@storyboard/story-ai/contracts`,
  `@storyboard/story-format/contracts`, `@storyboard/story-engine/contracts`. `story-engine/shared`
  itself must import only those, never a package barrel. Declare a new entry in the package's
  `exports` and in every consumer's tsconfig `paths`; `scripts/aliases.mjs` orders aliases
  longest-first so `pkg/contracts` is not shadowed by `pkg`.

### The parameter map

Every tunable data file carries the `*.params.json` suffix, so `git ls-files '*.params.json'` lists
them all. Each sits beside the zod schema that documents its knobs and is owned by the package whose
behaviour it changes.

| File | Owner | Holds |
|---|---|---|
| `packages/story-ai/src/contracts/modelProfiles.params.json` | story-ai | Per-model measured overrides, with the `measured` block recording where each number came from |
| `packages/story-ai/src/ai/prompts/promptTuning.params.json` | story-ai | `temperature` and `maxTokens` for every prompt, keyed by prompt module name |
| `packages/story-pipeline/src/pipelineDefaults.params.json` | story-pipeline | Model-agnostic generation defaults: skeleton ratio, retry limits, similarity thresholds, repetition windows, voice-sample bounds, context budgets, retry-candidate weights |
| `packages/story-sim/src/simDefaults.params.json` | story-sim | Measurement-side knobs: reader-panel size, repeat count, and the reference token prices the cost axis converts with |

Identifier tables stay TypeScript (`as const`) and live with their owner:
`providerCatalog.ts` and `settingCatalog.ts` (story-ai), `project.ts` / `paths.ts` / `narrator.ts`
(story-format), `contributionIds.ts` and `storyboardMessages.ts` (vscode), `commands/catalog.ts` (cli).

Adding a params file means: the `*.params.json` suffix, a sibling zod schema, a row in this table.

## Shared Package References

- Direction: apps import `@storyboard/*` entry points only; packages import other packages (declared
  ones only) and Node builtins — never `vscode`, app code, or browser APIs. Current graph:
  `format ← ai ← pipeline ← engine ← sim`, `engine ← node`, `engine, ai ← app`, `ai ← config`.
- **Every imported workspace package must be declared in that consumer's `package.json`** — do not
  rely on app-level aliases happening to resolve it.
- App-specific bans are build failures: the CLI must not import `@storyboard/story-pipeline`
  directly.
- When a utility is needed in a second app or package (atomic write, hashing, a logger contract),
  promote the existing one into a shared package instead of re-implementing it locally.

## Module Aliases

Two kinds of reference, two mechanisms. The architecture checks enforce both.

- **Inside an app**: `@/` maps to that app's `src/`. Every reference that climbs out of its own
  folder uses it — a bare `./sibling` is fine, `../` is a build failure. The webview keeps its own
  `@webview/` so the host and the browser bundle never share one prefix.
- **Inside a package**: a Node subpath import declared in the package's own `package.json`
  (`#engine/`, `#format/`, `#ai/`, `#git/`, `#pipeline/`). It is **not** a bundler alias, and that is
  the point: apps bundle package source, and a bundler's alias table is global, so a package using
  `@/` would silently resolve to the *app's* `src/` — a wrong file, no error, in a green build. A
  package must never use another package's prefix.
- **Across packages**: the package name (`@storyboard/story-format`), never a path.
- **One source of truth**: a project's own `tsconfig.json` holds its `paths`; `scripts/aliases.mjs`
  reads it and hands the same table to esbuild, Vite and Vitest. Never restate a path in a bundler
  config. Note that TypeScript replaces `paths` wholesale when a child config declares it, so a
  project that needs `@storyboard/*` repeats `@/*` in its own block rather than inheriting it.
- **`tsconfig.base.json`** at the repo root holds the shared compiler options; every workspace
  extends it and adds only its own `types`, browser `lib`, and `paths`.
