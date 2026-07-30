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

## Extension-side integration (`apps/desktop/src/infrastructure/storygram/`)

The extension is a **read-only observer** of the bot plus a writer of one file. It polls the
loopback dashboard for health (status bar, `storyboard.bot.openDashboard`) and the
`storyboard.bot.setup` wizard writes `~/.storygram/config.json` at mode 0600 — nothing else. Do not
make the extension own the bot's lifecycle beyond the wizard's one-shot install (build → launchd →
wait for health → open dashboard): the bot must keep running when VSCode is closed, which is its
whole reason to exist. Path and `STORYGRAM_HOME` rules are duplicated from
`apps/bot/src/config/paths.ts`; keep the two in step. The wizard's generated config must stay
acceptable to the bot's strict `configSchema`.

## Card formatting

Card serialization is canonical (fixed key order, block sequences), so a hand-authored card using
inline sequences reformats on its first programmatic write. That normalization is offered as its own
command — `/doctor` reports non-canonical cards and `/doctor format` rewrites them in a single
commit — so it never rides along inside a content edit's diff. `canonicalizeCardText`
(`packages/story-format/src/files/card.ts`) is the shared predicate; do not add a second one.

## Verification

Run from the repo root: `npm test` (drives both workspaces) and `npm run lint`.
Bot-only: `npm run test --workspace storygram`, `npm run lint --workspace storygram`,
`npm run bot:build`.

Sync and mutate tests use **real** git repositories in a temp directory — do not replace them with
stubs. The behaviours they pin (conflict aborts, index.lock refusal, scoped commits, ignore-before-
first-commit) only hold against real git.
