# Release Guide

This guide describes how to publish a Storyboard release to GitHub Releases. One tag ships every
app: the VSCode extension and the CLI.

## Prerequisites

- The release branch is ready to publish.
- **The version lives in the root `package.json`.** Every app mirrors it; `npm run version:sync`
  writes the root version into `apps/vscode`, `apps/cli` and the version string the
  CLI prints. Never hand-edit an app's version.
- The single root `package-lock.json` is refreshed by `npm install` after the sync.
- `CHANGELOG.md` and `CHANGELOG.en.md` carry the target version's section.
  They live at the repo root because one tag ships every app and the notes cover all of them;
  `package:vsix` copies `CHANGELOG.md` into `apps/vscode` (gitignored) so the VSIX still carries it.
- The working tree contains only intentional release changes.

## Cutting a version

```bash
# edit the root package.json "version", then
npm run version:sync
npm install
node scripts/sync-version.mjs --check   # what the release workflow enforces
```

## Local verification

Before tagging, run everything the tag would set off, in one command on the version commit:

```bash
npm run release:preflight
```

It checks that the tree is committed and on `main`, that the version is synced and not yet tagged,
and that both changelogs carry a dated, non-empty `## [<version>]` section; then it runs lint, the
tests and `npm run bvt`, and ends with `Preflight passed for v<version>`. Nothing
is tagged or uploaded. The pieces are also available one by one:

```bash
npm run compile
npm run build      # bundles both apps
npm run lint
npm test
npm run bvt        # the build verification test, see below
```

`npm run bvt` is what the workflow's `bvt` job runs between the source checks and the packaging
jobs. Its steps are also separate scripts:

- `npm run bvt:contracts` — diff contracts between the previous tag and HEAD: a change must carry
  its mandatory companion (source ↔ both changelogs, a prompt resource ↔ its generated module, a
  params file ↔ its schema and its coding-standards row, the config schema ↔ a settings test,
  `.claude/rules` ↔ `.cursor/rules`, a version bump ↔ its changelog
  section). `node scripts/bvt/checkDiffContracts.mjs v0.12.1` checks another range.
- `npm run bvt:impact` — the impact map (`bvt/impactMap.json`): the changed files pick the areas
  they touch, and the checks of those areas run — focused tests plus what `verify` does not run,
  such as the bundles and the prompt-resource check. A changed file that belongs to no area fails
  the run; give it a row. A deleted file that no area claims is only counted. `node scripts/bvt/runImpactMap.mjs v0.12.1 --plan` prints the plan for
  another range without running it.
- `npm run bvt:golden` — golden workspaces (`bvt/golden/`): the built CLI drives each scenario in
  `scenarios.json` with the `mock` provider and every file the work would commit is compared with
  the snapshot, with timestamps, ids, hashes and the version masked on both sides. The `reopen`
  scenarios open a frozen workspace an earlier release wrote and must leave it unchanged; their
  `draft generate --all` must generate nothing, though the git-ignored cache is not there. When a
  difference is intended, run `npm run bvt:golden -- --update`, read the snapshot diff, and commit
  it with the change.
- `npm run bvt:smoke` — the artifact smoke: `scripts/package-release.sh` packages the VSIX, the
  CLI tarball and `install.sh` into a scratch directory, then `scripts/bvt/smoke.sh` installs the
  tarball with the real `install.sh`, drives a mock work with the installed `storyboard` and checks
  the VSIX contents.

Reproduce the artifacts (the workflow runs the same script):

```bash
scripts/package-release.sh "$(node -p "require('./package.json').version")" release
```

The CLI build writes a runtime `dist/package.json` that lists only the bundle's esbuild externals as
dependencies (the source manifest's `@storyboard/*` workspace entries are inlined in the bundle and
would make `npm install` in an unpacked tarball fail). `package-tarballs.sh` ships that manifest at
the tarball root, never the source one.

## Version commit

The version commit should include at least:

- `package.json` (the version) and `package-lock.json`
- `apps/vscode/package.json`, `apps/cli/package.json`
- `apps/cli/src/index.ts` (the printed version)
- `CHANGELOG.md`, `CHANGELOG.en.md`

```bash
git add package.json package-lock.json apps/*/package.json apps/cli/src/index.ts \
  CHANGELOG.md CHANGELOG.en.md
git commit -m "chore: release v0.8.0"
```

## Tag and push

Only after `npm run release:preflight` has printed `Preflight passed` on this commit.

```bash
git tag v0.8.0
git push origin HEAD
git push origin v0.8.0
```

The tag must match the root `package.json` version with a leading `v`, and every app must already
be synced to it — the workflow checks both and refuses otherwise.

## GitHub Release workflow

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`. The workflow:

1. `verify` (ubuntu, Node 20) installs with `npm ci`, checks the tag matches the root version and
   that every app is synced to it, runs lint and tests from the repository root, then opens the
   release as a **draft** with no assets.
2. `bvt` (ubuntu, Node 20, full clone for the tags) runs the build verification test described
   under *Local verification*: the diff contracts, the impact map, the golden workspaces, then
   packages the VSIX and the CLI tarball and smokes them. A failure here leaves the draft release
   empty.
3. `publish` packages `storyboard-vscode-<version>.vsix` and `storyboard-cli-<version>.tar.gz`,
   copies `scripts/install.sh` alongside and creates `SHA256SUMS` over everything.
4. Builds the release notes from the `## [<version>]` section of `CHANGELOG.md`
   (with `CHANGELOG.en.md` in a collapsed `English` block). Only that version's entries go into
   the release body; the job fails if the section is missing.
5. Uploads the assets and takes the release out of draft, so a run that dies partway never leaves
   a half-built release visible.

## One public repository

`maroomir/storyboard` is public and is the whole product: the source under Apache-2.0, the
changelogs, `scripts/install.sh`, and the releases every app installs and updates from. There is
no mirror; the former `webfic/storyboard` is gone, and a release is published once, here.

- `scripts/install.sh` defaults to `STORYBOARD_REPO=maroomir/storyboard`; set the variable to
  install from a fork's release instead.

## How users install

- **Extension** — download the `.vsix` and install it from VS Code.
- **CLI** — `curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash`.
  The script resolves the latest release, verifies the checksum, unpacks the CLI into
  `~/.local/share/storyboard` and links `~/.local/bin/storyboard`. The tarball is a bundled Node
  script, so the machine needs Node 20 or newer. With the tarball already downloaded (an offline
  machine), `./install.sh --from <dir>` installs from that directory instead
  and verifies `SHA256SUMS` when it is there too.

If the workflow fails, delete the failed tag only after deciding whether the release commit itself
should change.

```bash
git tag -d v0.8.0
git push origin :refs/tags/v0.8.0
```

Then fix the release commit, recreate the tag, and push it again.
