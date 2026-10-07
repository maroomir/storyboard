# Release (versioned cuts)

When preparing a Storyboard release (version bump, changelog, the extension/CLI/desktop artifacts, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match the repo-root **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

The version lives in the **root `package.json`**; `npm run version:sync` mirrors it into `apps/vscode`, `apps/cli`, `apps/desktop` and the version the CLI prints, and `node scripts/sync-version.mjs --check` is what the release workflow enforces. Run `npm install` afterwards so the root `package-lock.json` follows. One `v*` tag ships every app: the VSIX, the CLI tarball, and the desktop installers with their update feed. **`CHANGELOG.md`** and **`CHANGELOG.en.md`** stay the source of the release notes — update both in the same change.

## Build verification test (BVT)

`npm run bvt` is the gate between the source checks and the jobs that build what ships: the
release workflow runs it as the `bvt` job after `verify`, and a tag that fails it stays a draft
with nothing uploaded. Run it locally before tagging. The code lives in `scripts/bvt/`,
and each step is also its own script:

- `bvt:contracts` — **diff contracts** (`scripts/bvt/diffContracts.mjs`): a change that has a
  mandatory companion must carry it in the same range — source ↔ both changelogs, a prompt
  resource ↔ its generated module, a params file ↔ its sibling schema and its coding-standards row,
  the config schema ↔ a settings test, `ko.ts` ↔ `en.ts`, `.claude/rules` ↔ `.cursor/rules`, a
  root version bump ↔ its `## [version]` section. The range is the newest `v*` tag that is an
  ancestor of HEAD (not HEAD itself) up to HEAD; pass another base ref as the first argument.
  Adding a rule is a row in `diffContractRules` plus a case in `apps/cli/test/bvtDiffContracts.test.ts`.
