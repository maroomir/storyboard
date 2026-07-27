# Telegram Bot (`apps/bot`, product name `storygram`)

The bot is a second front end onto the **same** Storyboard workspace the VSCode extension opens.
It runs on the user's own machine, reaches Telegram by long polling, and stores nothing of its own
except operational state.

## Non-negotiable invariants

- **A successful save of a tracked file is always a commit.** Writes go through
  `MutateGate` (`apps/bot/src/workspace/mutateGate.ts`) and nothing else. Adding a new write path means
  routing it through `ContentService`, not calling the filesystem directly.
- **Freshness guard.** Every write re-reads its target immediately before writing and refuses when
  the bytes no longer hash to the baseline the edit was derived from. This is what makes it safe for
  the bot and the extension to edit one directory at the same time. Never cache a long-lived
  snapshot of workspace content; read through.
- **Commits name explicit paths.** `git add .` is forbidden — a bot commit must never sweep in the
  user's unrelated uncommitted work.
- **Generated artifacts are written but not committed.** `draft/`, `.draft/`, `manuscript/`, and
  `.storyboard/cache/` are gitignored exactly as the extension scaffolds them.
- **No seedcoat.** The bot was rebuilt without the `.seed` archive. `apps/bot/scripts/check-architecture.mjs`
  fails the build if a `seed` import reappears.

## Security

- Allowlist is checked before any handler runs; unauthorized updates are dropped silently.
- Long polling only — there is no inbound listener and no public port.
- The dashboard binds loopback only.
- The bot token lives in `~/.storygram/config.json` (mode 0600) and is never logged or serialized.
- Git is invoked with `execFileSync` and an argument array, never a shell.

## Layering

`util → config → store → workspace → sync → content → ai → provider → gen → chat → telegram →
dashboard → app`. A layer may import itself and anything to its left. `apps/bot/scripts/check-architecture.mjs`
enforces the direction and rejects cycles.

## Config

`~/.storygram/config.json`, overridable with `STORYGRAM_HOME`. `workspace.path` must be an absolute
path to a real Storyboard workspace (`.storyboard/project.json` must exist). `workspace.remote` is
optional: with no remote the bot still commits every save and `/sync` settles as `no-remote` without
touching the network. `draft.reviseAfterGenerate` (default true) runs the shared review→revise loop
after every generation; `draft.reviseMaxIterations` (1–5, default 2) bounds it. Full example:
`apps/bot/config.example.json`; operator docs: `apps/bot/README.md`.

## Git onboarding

The extension writes a `.gitignore` but never runs `git init`, so a real workspace may not be a
repository yet. `inspectWorkspaceRepository` reports that, and `initializeWorkspaceRepository` fixes
it in the required order: init → ensure the ignore block → commit the existing content. Doing the
ignore step first is what keeps generated drafts out of the first commit.

## Verification

Run from the repo root: `npm test` (drives both workspaces) and `npm run lint`.
Bot-only: `npm run test --workspace storygram`, `npm run lint --workspace storygram`,
`npm run bot:build`.

Sync and mutate tests use **real** git repositories in a temp directory — do not replace them with
stubs. The behaviours they pin (conflict aborts, index.lock refusal, scoped commits, ignore-before-
first-commit) only hold against real git.
