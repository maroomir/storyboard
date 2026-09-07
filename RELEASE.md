# Release Guide

This guide describes how to publish a Storyboard release to GitHub Releases. One tag ships both
apps: the VSCode extension and the CLI.

## Prerequisites

- The release branch is ready to publish.
- **The version lives in the root `package.json`.** Every app mirrors it; `npm run version:sync`
  writes the root version into `apps/vscode`, `apps/cli` and the version string the
  CLI prints. Never hand-edit an app's version.
- The single root `package-lock.json` is refreshed by `npm install` after the sync.
- `apps/vscode/CHANGELOG.md` and `apps/vscode/CHANGELOG.en.md` carry the target version's section.
  The changelogs stay in `apps/vscode` because the release notes are built from them.
- The working tree contains only intentional release changes.

## Cutting a version

```bash
# edit the root package.json "version", then
npm run version:sync
npm install
node scripts/sync-version.mjs --check   # what the release workflow enforces
```

## Local verification

Run the same checks the release workflow runs.

```bash
npm run compile
npm run build      # bundles both apps
npm run lint
npm test
```

Reproduce the artifacts:

```bash
version="$(node -p "require('./package.json').version")"
mkdir -p release
npm run package:vsix --workspace storyboard-vscode -- --out "$PWD/release/storyboard-vscode-${version}.vsix"
npm run cli:build
scripts/package-tarballs.sh "$version" release
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
- `apps/vscode/CHANGELOG.md`, `apps/vscode/CHANGELOG.en.md`

```bash
git add package.json package-lock.json apps/*/package.json apps/cli/src/index.ts \
  apps/vscode/CHANGELOG.md apps/vscode/CHANGELOG.en.md
git commit -m "chore: release v0.8.0"
```

## Tag and push

```bash
git tag v0.8.0
git push origin HEAD
git push origin v0.8.0
```

The tag must match the root `package.json` version with a leading `v`, and every app must already
be synced to it — the workflow checks both and refuses otherwise.

## GitHub Release workflow

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`. The workflow:

1. Installs dependencies with `npm ci`.
2. Verifies the tag matches the root version and that both apps are synced to it.
3. Runs lint and tests from the repository root.
4. Packages two artifacts: `storyboard-vscode-<version>.vsix` and `storyboard-cli-<version>.tar.gz`.
5. Copies `scripts/install.sh` alongside them and creates `SHA256SUMS` over everything.
6. Builds the release notes from the `## [<version>]` section of `apps/vscode/CHANGELOG.md`
   (with `CHANGELOG.en.md` in a collapsed `English` block). Only that version's entries go into
   the release body; the job fails if the section is missing.
7. Creates a GitHub Release with all three assets and the checksum attached.
8. Publishes the same notes and assets to the public repository, `webfic/storyboard`: it copies
   both changelogs and `scripts/install.sh` there, commits, tags and pushes, then creates the
   matching GitHub Release. The step needs the `WEBFIC_RELEASE_TOKEN` secret (a fine-grained PAT
   with `contents: write` on `webfic/storyboard`); without it the step logs a warning and the
   release stays private only.

## The public repository

`webfic/storyboard` is the user-facing side of the product: README, changelogs, `install.sh`,
issue templates, the wiki, and the releases. It holds **no source** — the source stays here.

- Every release is published **twice**, here and there, under the same tag.
- The wiki is not updated by the workflow. When user-facing behavior changes, update the wiki
  pages by hand (or ask an agent to) — they are at `github.com/webfic/storyboard/wiki`.
- Users install from the public repository, so `scripts/install.sh` defaults to
  `STORYBOARD_REPO=webfic/storyboard`. Set that variable to install from a private release instead.

## How users install

- **Extension** — download the `.vsix` and install it from VS Code.
- **CLI** — `curl -fsSL https://raw.githubusercontent.com/webfic/storyboard/main/install.sh | bash`.
  The script resolves the latest release, verifies the checksum, unpacks the CLI into
  `~/.local/share/storyboard` and links `~/.local/bin/storyboard`. The tarball is a bundled Node
  script, so the machine needs Node 20 or newer. With the tarball already downloaded (private
  repository, offline machine), `./install.sh --from <dir>` installs from that directory instead
  and verifies `SHA256SUMS` when it is there too.

If the workflow fails, delete the failed tag only after deciding whether the release commit itself
should change.

```bash
git tag -d v0.8.0
git push origin :refs/tags/v0.8.0
```

Then fix the release commit, recreate the tag, and push it again.
