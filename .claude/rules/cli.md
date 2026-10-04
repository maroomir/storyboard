# CLI (`apps/cli`, product name `storyboard`)

The CLI is the **headline product and the reference implementation**. It runs the same engine the
extension runs, in a terminal, so another AI agent can write a novel without an editor.

## Non-negotiable invariants

- **The CLI owns no orchestration.** Every verb calls a manager verb on the shared
  `StoryboardApplication` (`container.drafts.generate(…)`, `container.novel.run(…)`). Assembling pipeline
  stages by hand here would be the third copy of the generation loop (after the extension and the
  harness), so `apps/cli/scripts/check-architecture.mjs` fails the build if the CLI imports
  the engine's pipeline assembly symbols (`SceneGenerationPipeline`, `runSceneGenerationPipeline`,
  `sceneStages`, `runReviseLoop`).
- **Parity is a test, not a promise.** `apps/cli/test/parity.test.ts` maps every
  `contributes.commands` entry in `apps/vscode/package.json` to a CLI verb, an editor-only
  exemption, or a tracked gap. Adding a command to the extension without a verb fails CI. The
  pending list must only ever shrink.
- **stdout carries the result; everything else goes to stderr.** `--json` output must stay pipeable.
- **Exit codes are the contract.** 0 on success, non-zero on failure — an agent branches on it.
- **The CLI does not commit.** It writes files and leaves git to the user, exactly like the
  extension. `init` (and `init --repair`) does run `git init` when the directory is not a
  repository yet — the ignore block is written first, so a fresh workspace is born tracked with
  nothing generated in reach of the first commit — but that first commit is still the user's.
- **One writer per workspace.** A verb whose catalog entry says `writesWorkspace: true` takes
  `.storyboard/cache/run.lock` for its duration and refuses (exit 1) while the desktop app, the
  extension or another CLI holds it. Read-only verbs never wait on it. `apps/cli/test/runLock.test.ts`
  fails when a verb is added without saying which kind it is.

## Layering

`adapters → commands`. A layer may import itself and anything to its left;
`apps/cli/scripts/check-architecture.mjs` enforces the direction and rejects cycles.

## Host adapters

Only six files differ from what the extension supplies, which is the whole point of the engine
boundary: `NodeFileSystem` (temp-file-then-rename writes), `NodeUri` (posix `path`, OS `fsPath`),
`NodeWorkspaceLocator` (one workspace, containment test), `ConsoleLogger` (stderr), the
file-backed `SecretStore`/`ConfigBridge`, and `gitRepository` (probe and `git init` through
`execFileSync`, used by `init` and `doctor` only). `NodeFileSystem` and `NodeWorkspaceLocator` live
in `@storyboard/story-node` because every Node host needs the same two.

## Config

`~/.storyboard/config.json` (shared with the extension), overridden per workspace by
`.storyboard/config.json`, overridable wholesale
with `STORYBOARD_HOME`. Keys are the `storyboard.*` setting names minus the prefix, so a config file
reads like the extension's settings UI. Secrets live in `~/.storyboard/secrets.json` at 0600. Both
files come from `@storyboard/story-config` and are validated against its config schema when read: a
value the schema rejects fails the run with `ConfigFileError('invalid-value')`, a key nothing reads is
logged as a warning and kept; the pre-0.8 `cli.json`/`cli-secrets.json` are no longer
read at all. **Writes follow git's rule**: `setup` and `config set` write the workspace file when run
inside a workspace, `--global` writes the home file, and outside a workspace they refuse rather than
guess. `dispatch.ts` decides that once and hands the target to `ConfigBridge` (`writeTarget`); no
command picks a file on its own. Secrets are exempt — always the one 0600 home file.
**Author resources are data too**: the home `~/.storyboard` and the workspace's `.storyboard` are
two resource roots (workspace wins), and `packages/story-app/src/resourceOverrides.ts` owns what a
root may hold — `prompts/<key>.md` replaces the bundled resource of that prompt (bundled texts in
`packages/story-ai/src/ai/prompts/resources/`), `craftContract.json` lays over the bundled craft
contract (`packages/story-model/src/format/craftContract.params.json`), `promptVariants.json` over the
variant selection rules (`packages/story-ai/src/ai/prompts/promptVariants.params.json`), `compositionPresets.json` over what the composition presets build
(`packages/story-model/src/format/compositionPresets.params.json`), and `pipelines/scene.yaml` /
`pipelines/novel.yaml` over the stage order of the two pipelines (checked against
`sceneStageCatalog` and `novelStageCatalog`; a required stage cannot be dropped). `doctor` lists the
files in force and fails on one it cannot use. `dispatch.ts` loads them before a
workspace verb runs, warning about files it cannot use.
`setup` / `doctor` / `config show|set` / `params show` are the onboarding
verbs (`apps/cli/src/commands/setup.ts`); the command catalog in `apps/cli/src/commands/catalog.ts`
is the single source for the parser's flag table, `--help`, per-verb help and `needsWorkspace`, and
`apps/cli/test/help.test.ts` fails when a verb is implemented without a catalog entry.

## Narration verbs

`narrator add|list|show|remove`가 서술자 카드를 다루고, `init`·`project set`의 `--composition`이
구성 프리셋을 적용한다(프리셋이 줄기와 서술자 카드를 만든다). `scene show <stem>`은 해석된
시점·줄기를 한 줄로 보여 주고, `doctor`는 카드 없는 서술자 참조를 실패로, 계약에 없는 줄기와
초점 없는 1·2인칭 서술자를 경고로 보고한다.

## Note import (`apps/cli/src/commands/notes.ts`)

`notes absorb <path|url>` reads an Obsidian folder or note (every note under it, in name order) or a
Notion page or full-page database (sub-pages in page order, database rows in title order, since
Notion exposes no view order), plus the notes their text links to
— one step, no further. The requests run in order and each is shown the people and places the
earlier ones found beside the existing cards, so one subject keeps one id; entries merge by name,
then id, and only after every request is read, a name that is the alias of exactly one other entry when the named entry has no id of its own; entries that only share an alias stay apart. The model sorts them into character/background cards, scene cards, the
contract and a synopsis — one scene card per note, its events as beats; prose already written
(`draft`) gives cards and the contract but never a scene. What it cannot place is reported and never
written. Nothing that exists
is overwritten: a card that exists gets candidates in `.storyboard/cache/notes/candidates.json`,
which `card promote` applies beside the draft candidates; an existing synopsis gets
`synopsis.candidate.md`; the contract is only proposed (`project set …`), except that
`init --from-notes` fills the empty fields of the work it just made. Scenes follow the last scene
number in the order the notes were read — the model never reorders them. A person is asked before
the paid step and before writing; without a TTY the verb stops at the estimate unless `--yes` is
given, and `--dry-run` stops at the plan. The Notion integration token lives in `secrets.json`
(`notes connect notion`). The collected notes, the plan and each model response (`responses.json`)
stay in the git-ignored cache. A request cut at the output limit or without a readable result is a
warning naming its notes, and when no request could be read the verb fails rather than report an
empty plan. List items that differ only in spacing or punctuation are one item (absorb, `card
promote` and the draft candidates share that rule); a person whose traits and tags were read in more
than one request, or whose card already has some, gets one more request that keeps one wording per
meaning — chosen from the candidates, never rewritten — and when it fails the merged lists stand
with a warning.

## Editor-only surface

Inline completion, hover, the `.card` custom editor and the relation graph are editor chrome, not
capabilities — they have no terminal form. What is portable is the *ability* behind a provider: the
three diagnostics become `check` verbs, the card editor becomes card CRUD verbs. Do not add an
entry to the parity test's editor-only list without that argument holding.

## Interactive screen (`apps/cli/src/tui`)

`storyboard` at a terminal with no arguments, or `storyboard tui`, renders an Ink app. It is a
third layer (`adapters → commands → tui`) that only calls `commands/dispatch.ts` — the same entry
`index.ts` uses for one-shot runs — so a verb behaves identically typed at the prompt or on the
shell line. Because Ink and yoga-layout use top-level await the bundle is ESM (`dist/index.mjs`);
`esbuild.config.mjs` adds a `createRequire` banner for CJS dependencies and aliases
`react-devtools-core` to a stub. Nothing outside `tui/` may import `ink` or `react`. The TUI refuses
to start without a TTY so agents never end up inside it.

## Shell completion (`apps/cli/src/commands/completion.ts`)

`storyboard completion <zsh|bash|fish>` prints a script that delegates every Tab to the hidden
`storyboard __complete <words…>` verb, which `dispatch.ts` answers before the argument parser runs
(a half-typed flag must not be rejected). Candidates come from the catalog (verbs, per-verb flags,
`<stem>`/`<id>`/`<provider>`/`<key>` positional slots) plus the workspace's `scene/` and card
directories; output is `text<TAB>description` per line. `scripts/install.sh` appends the
registration line to the running shell's rc file under a `# storyboard completion` marker.

## Verification

From the repo root: `npm test` and `npm run lint` (both drive both apps).
CLI-only: `npm run test --workspace @storyboard/cli`, `npm run lint --workspace @storyboard/cli`,
`npm run cli:build`.
