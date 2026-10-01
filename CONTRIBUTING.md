# Contributing to Storyboard

Storyboard generates long-form fiction in small, inspectable steps: a project contract, cards,
an outline, scene seeds, scene drafts, reviews, and an assembled manuscript. Three apps (a VS Code
extension, a CLI and a desktop app) run the same engine. Contributions of any size are welcome, and
the maintainer is one person, so small, focused pull requests get the fastest turnaround.

한국어 사용자: 이슈와 PR은 한국어로 써도 됩니다. 아래 규칙은 언어와 무관합니다.

## Set up in five commands

Node 20 or newer is required. No API key is needed: every test runs against the built-in `mock`
provider.

```bash
npm ci              # install every workspace from the root
npm run lint        # architecture checks, eslint, tsc, prettier — for every workspace
npm test            # the three apps' test suites (packages are tested through the apps)
npm run build       # bundle the extension, the CLI and the desktop app
npm run cli:build && node apps/cli/dist/index.mjs --help
```

`npm run lint` is what CI runs first. If it is green locally, the pull request is almost always
green too.

## Where things live

| Path | Owns |
|---|---|
| `packages/story-format` | Workspace file format: schemas, codecs, paths, the round-trip fixtures |
| `packages/story-ai` | Providers, prompts (`src/ai/prompts/resources/*.md`), response contracts |
| `packages/story-pipeline` | The scene and novel generation stages |
| `packages/story-engine` | Domain policies, use cases, repositories, the ports a host implements |
| `packages/story-app` | `StoryboardApplication`: builds the object graph once for every app |
| `packages/story-config` | `~/.storyboard`: config layers, the 0600 secrets file, watchers |
| `packages/story-node` | Node adapters shared by the CLI and the desktop app |
| `packages/story-sim` | Quality and cost measurement (knob sweeps, reader panel) |
| `apps/cli` | The reference implementation. Every verb calls the engine; it owns no orchestration |
| `apps/vscode` | The extension: VS Code adapters, commands, the webview |
| `apps/desktop` | Electron: main, preload and renderer meet only through `src/shared` |

`ARCHITECTURE.md` describes the workspace a writer sees. The rules under `.claude/rules/` are the
detailed conventions; `coding-standards.md` and `clean-code.md` are the two to read before a larger
change.

Typical changes and what they touch:

- **A new AI provider**: a catalog row in `packages/story-ai/src/contracts/providerCatalog.ts` plus
  a provider module that registers itself. The registry is not edited.
- **A prompt wording change**: the Markdown resource under `packages/story-ai/src/ai/prompts/resources/`.
  Temperature and output limits live in that file's front matter.
- **A generation knob**: one of the `*.params.json` files listed in `.claude/rules/coding-standards.md`,
  next to the zod schema that documents it.
- **A CLI verb**: the handler in `apps/cli/src/commands/`, its row in `commands/catalog.ts`, and the
  tests in `apps/cli/test/` that fail when the two disagree.
- **An extension command**: `apps/vscode/package.json`, its registration, and a CLI verb or a
  documented exemption. `apps/cli/test/parity.test.ts` fails when the extension gains a command the
  CLI cannot run.
- **A desktop screen**: the IPC channel in `src/shared/ipcContract.ts` with its zod schema, the
  handler, and strings added to `src/shared/i18n/ko.ts` first (`en.ts` is typed against it).

## What the checks enforce

A green run means exactly this, no more:

- The root `scripts/architecture/check-workspace.mjs`: no package imports `vscode`, an app module or
  another package's `#` internal prefix, and every owned literal stays in its owner file.
- Each app's `scripts/check-architecture.mjs`: that app's layer direction and no import cycles.
- Tests run against real temporary git repositories and the `mock` provider; nothing calls a
  network.

## Conventions that reviews will ask for

- Files are camelCase, including class modules. Acronyms capitalize the first letter only (`Ai`).
- Ports and substitutable contracts take the `I` prefix; DTOs are plain `readonly` interfaces.
- Boundaries (config files, RPC payloads, workspace files) are zod schemas; types derive from them.
- Expected failures are returned as discriminated unions; programmer errors are thrown as typed
  errors with a `code`. No silent catches in the middle layers.
- Messages shown to writers are Korean. Code comments may be Korean or English; add a comment only
  for intent or a constraint the code cannot express.
- Do not add features, abstractions or configuration beyond what the change needs.

## Pull requests

- One topic per pull request. A refactor and a behavior change go in separately.
- Add or update tests when behavior changes. Say in the description what you verified by hand.
- History is linear: pull requests are rebased onto `main`, never merged with a merge commit.
- Sign off every commit (`git commit -s`). The `Signed-off-by` line is your
  [Developer Certificate of Origin](https://developercertificate.org/) statement.
- Subject line: English, imperative, 50 characters or fewer, no trailing period, optionally
  `type(topic): ` prefixed (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`). The body may be
  English or Korean. The maintainer's own commits carry a Korean four-label body
  (`[Issue] [Problem] [Cause & Measure] [Checking Method]`); external contributions are not asked to
  follow that format.
- Do not add `Co-Authored-By` trailers for AI tools.

Expect a first reply within a few days. Issues labeled `good first issue` are scoped to be finished
in one sitting; `help wanted` marks work the maintainer would like but has not scheduled.

## Contributions written with AI agents

Welcome. Storyboard is itself a tool that agents drive, and this repository ships `AGENTS.md` and
`CLAUDE.md` so an agent working here follows the same rules as a person. Two conditions:

- You have run the code and read the diff. You are the author; the agent is a tool.
- The change still fits the conventions above. An agent that adds abstractions "for flexibility"
  produces a pull request that will be asked to shrink.

## Reporting problems

Bugs and feature requests go to GitHub issues using the templates. Anything touching API keys,
file writes outside the workspace, or the desktop app's git operations goes through `SECURITY.md`
instead.
