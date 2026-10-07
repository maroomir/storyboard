# Desktop app (`apps/desktop`, product name Storyboard)

The desktop app is Storyboard for writers who are not developers: a manuscript-first desk (design B)
with the pipeline console (design C) in a drawer. It runs the same engine as the CLI and the
extension; only its host adapters and screens are its own.

## Non-negotiable invariants

- **The desktop owns no orchestration.** It calls the manager verbs of the shared
  `StoryboardApplication` (`drafts.generate`, `drafts.saveEdit`, `novel.run`, …) and never assembles
  pipeline stages.
  `apps/desktop/scripts/check-architecture.mjs` fails on an import of the engine's pipeline
  assembly symbols.
- **One process folder per Electron process.** `src/main` (Node), `src/preload`, `src/renderer`
  (browser) meet only through `src/shared` (the IPC contract, DTOs, messages). The architecture check
  enforces the allow-list, keeps Node builtins, `electron` and package barrels out of the renderer
  and `shared` (only `@storyboard/story-model/contracts`), and keeps the preload down to `electron` plus `shared`.
- **The renderer is untrusted.** Every channel in `src/shared/ipcContract.ts` has a zod request
  schema, and `src/main/ipcRouter.ts` parses before any handler runs. Scenes and cards are addressed
  by pattern-checked ids, never paths. A path from the renderer is accepted only when main offered it
  (the recent list, the default parent, a folder main's dialog returned).
- **The desktop commits; nothing else does.** It is the one exception to "the app writes files and
  leaves git to the user": `src/main/snapshotService.ts` (isomorphic-git, so no git install is
  needed) records a version on open, on close, per chapter of a run, after a scene run, after an AI
  edit, when an editing session ends, after each story-bible save, and after a scene is renumbered or
  renamed. It never pushes, and a restore
  is a new commit that first snapshots the current state — history is never rewritten.
- **One writer per workspace.** Runs take the engine's run lock; while any app holds it, every
  desktop write is refused (`workspace-locked`) and the editor is read-only.
- **Pause is a scene-boundary stop.** The desktop never signals `shouldCancel`; the pause button and
  the budget both use `shouldPause`, which never throws away a scene in progress.

## Layout

| Path | Role |
|---|---|
| `src/shared/ipcContract.ts` | Channels, request schemas, response types, events, the `window.storyboard` bridge type |
| `src/shared/dto.ts` | Response shapes (types only) |
| `src/shared/ipcChannelNames.ts` | The channel-name constants the preload bundles (kept free of zod) |
| `src/shared/i18n/` | `ko.ts` (source), `en.ts` (typed against it), `translate.ts` — used by main and renderer |
| `src/main/index.ts` | Electron entry: window, IPC wiring, quit flow, auto-update |
| `src/main/desktopApp.ts` | App state without Electron (ports injected): open/create/close, language, settings |
| `src/main/desktopContainer.ts` | Builds the desktop's host adapters for one open workspace and hands them to `StoryboardApplication` |
| `src/main/workspaceSession.ts` | One open work: container, snapshots, run controller, bible, edit sessions |
| `src/main/runController.ts` | The one run at a time: novel or scene, lock, budget, approvals, pause |
| `src/main/invokeHandlers.ts` | Channel → service table |
| `src/renderer/` | React screens: Welcome, Wizard, Desk, Bible, Settings, History; the run drawer |

## Language

The UI is Korean and English. Add a string to `src/shared/i18n/ko.ts` first; `en.ts` is typed as
`Record<MessageKey, string>`, so a missing translation fails the typecheck, and
`test/messages.test.ts` fails when a translation drops a `{placeholder}`. Tables story-model already
names in Korean (point of view, composition, narrator person/knowledge/tense) are not copied: the
Korean UI reads them, and `src/renderer/lib/narrativeLabels.ts` holds only the English side.
Engine messages (errors, progress) stay Korean in both languages.

## State

- Workspace content and the version history live in the workspace (its git repository).
- Settings: provider, model and generation options go to `~/.storyboard/config.json`; the run budget
  (`budget.run.limitUsd`) goes to the workspace's `.storyboard/config.json`. Keys: `secrets.json`.
- App-only state (recent works, language) is `~/.storyboard/desktop.json`.
- Author resources: `~/.storyboard` and the work's `.storyboard` (work wins) are laid over the
  bundled defaults when a work opens — `prompts/<key>.md` for prompt wording, `craftContract.json`
  for the craft contract, `promptVariants.json` for the variant selection rules,
  `compositionPresets.json` for the thread names and counts the composition presets build,
  `pipelines/scene.yaml` and `pipelines/novel.yaml` for the stage order of the two pipelines.

## Smoke mode

`STORYBOARD_DESKTOP_SMOKE=1` makes main render the first screen and exit: 0 once the renderer has
mounted into `#root`, 1 on a load failure, a renderer crash or the 30 s limit. No update check runs
and nothing is written. The release workflow runs the packaged app this way on both platforms
(`scripts/bvt/smokeDesktop.sh mac|win`); locally `npm run bvt:smoke:desktop` runs the built app.

## Packaging

`electron-builder.config.cjs` packages `dist/` alone (everything is bundled, so no `node_modules`
ships): dmg + zip for macOS arm64/x64, NSIS for Windows x64, update feed on this
repository's releases. The release workflow's `desktop` job builds them on macOS and Windows
runners; signing turns on when its secrets exist (see `RELEASE.md`). The icon source is
`build/icon.svg`; `build/icon.png` is rendered from it (`rsvg-convert -w 1024 -h 1024`).

## Verification

From `apps/desktop`: `npm run lint`, `npm test`, `npm run build`. Tests run the main side through the
real router with the engine's `mock` provider and real temporary git repositories. The GUI itself is
checked by hand with `DESKTOP_QA.md`.
