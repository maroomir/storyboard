# Release (versioned cuts)

When preparing a Storyboard release (version bump, changelog, the extension/CLI/desktop artifacts, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match the repo-root **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

The version lives in the **root `package.json`**; `npm run version:sync` mirrors it into `apps/vscode`, `apps/cli`, `apps/desktop` and the version the CLI prints, and `node scripts/sync-version.mjs --check` is what the release workflow enforces. Run `npm install` afterwards so the root `package-lock.json` follows. One `v*` tag ships every app: the VSIX, the CLI tarball, and the desktop installers with their update feed. **`CHANGELOG.md`** and **`CHANGELOG.en.md`** stay the source of the release notes — update both in the same change.

## Build verification test (BVT)

`npm run bvt` is the gate between the source checks and the jobs that build what ships: the
release workflow runs it as the `bvt` job after `verify`, and a tag that fails it stays a draft
with nothing uploaded. Run it locally before tagging. The code lives in `scripts/bvt/`, the data
in `bvt/`, and each step is also its own script:

- `bvt:contracts` — **diff contracts** (`scripts/bvt/diffContracts.mjs`): a change that has a
  mandatory companion must carry it in the same range — source ↔ both changelogs, a prompt
  resource ↔ its generated module, a params file ↔ its sibling schema and its coding-standards row,
  the config schema ↔ a settings test, `ko.ts` ↔ `en.ts`, `.claude/rules` ↔ `.cursor/rules`, a
  root version bump ↔ its `## [version]` section. The range is the newest `v*` tag that is an
  ancestor of HEAD (not HEAD itself) up to HEAD; pass another base ref as the first argument.
  Adding a rule is a row in `diffContractRules` plus a case in `apps/cli/test/bvtDiffContracts.test.ts`.
- `bvt:impact` — **impact map** (`bvt/impactMap.json`, `scripts/bvt/runImpactMap.mjs`): every
  changed file in the range is matched against `ignore`, then against the areas in order, and the
  first area whose `paths` match owns it; the checks of every touched area run once each (test runs
  of one workspace are merged into one vitest start), with `STORYBOARD_HOME` pointed at an empty
  directory so the machine's config cannot change the answer. **A file no row claims fails the
  run**, and `apps/cli/test/bvtImpactMap.test.ts` fails as soon as a tracked file has no row, so a
  new folder gets its row before it ships. `--plan` prints the checks without running them. An
  area's checks are the focused tests of what it changes plus what `verify` does not run: the
  bundles, the prompt-resource check, the workflow YAML parse.
- `bvt:golden` — **golden workspaces** (`bvt/golden/scenarios.json`, `scripts/bvt/runGolden.mjs`):
  the built CLI drives each scenario with the `mock` provider (deterministic, free) and every
  file the work would commit is compared with the snapshot under `bvt/golden/<id>/`, after both
  sides mask what is minted per run (timestamps, uuids, content hashes, the version string). A
  `fresh` scenario runs `init` → `setup` → `novel generate` → `manuscript export` → `status`; a
  `reopen` scenario copies a **frozen** workspace an earlier release wrote (`bvt/golden/frozen/`,
  never rewritten by `--update`) and runs the reading and assembling verbs on it, so the candidate
  proves it still opens what is on a writer's disk unchanged. An intended format change is
  approved by `npm run bvt:golden -- --update` and the snapshot diff in the same commit; a new
  frozen workspace is a copy of a fresh snapshot's `workspace/` made at a release and a `reopen`
  row pointing at it.
- `bvt:smoke` — **artifact smoke** (`scripts/bvt/smoke.sh`, local wrapper `smokeRelease.sh`): the
  VSIX, the CLI tarball and `install.sh` are packaged by `scripts/package-release.sh` (the same
  script `publish` uses) and then *used*: `install.sh --from` installs the tarball into a scratch
  prefix, the installed `storyboard` prints the version and drives a mock work through
  `novel generate`, `draft show`, `scene create`, `status --json` (stdout must parse as a JSON
  result) and `manuscript export`; the VSIX is unzipped and its manifest version, `main`, webview
  page and changelog checked and the bundle parsed. `bvt:smoke:desktop` builds the desktop app and
  starts it with `STORYBOARD_DESKTOP_SMOKE=1` (`scripts/bvt/smokeDesktop.sh dev`); the release
  workflow runs the same on the **packaged** app in the `desktop` job on macOS and Windows.

`npm run bvt` runs the four in that order; `bvt:smoke:desktop` is separate because it needs the
Electron binary, which the `bvt` runner does not download.

## Preflight before the tag

**An agent never creates a release tag without `npm run release:preflight` passing on that commit.**
`scripts/release-preflight.sh` runs what the tag would set off, minus the upload: the tree must be
committed and on `main`, the version synced and untagged, both changelogs carrying a dated,
non-empty `## [<version>]` section; then lint, the tests, `npm run bvt` and the desktop smoke
(`-- --package` adds the packaged app for this platform). A tag that fails on GitHub is then the
exception; the Windows app smoke is the one check only the workflow can do.
