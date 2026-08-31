# Release Guide

This guide describes how to publish a Storyboard release to GitHub Releases. One tag ships all
three apps: the VSCode extension, the Telegram bot and the CLI.

## Prerequisites

- The release branch is ready to publish.
- **The version lives in the root `package.json`.** Every app mirrors it; `npm run version:sync`
  writes the root version into `apps/desktop`, `apps/bot`, `apps/cli` and the version string the
  CLI prints. Never hand-edit an app's version.
- The single root `package-lock.json` is refreshed by `npm install` after the sync.
- `apps/desktop/CHANGELOG.md` and `apps/desktop/CHANGELOG.en.md` carry the target version's section.
  The changelogs remain desktop-owned because the release notes are built from them.
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
npm run build      # bundles all three apps
npm run lint
npm test
```

Reproduce the artifacts:

```bash
version="$(node -p "require('./package.json').version")"
mkdir -p release
npm run package:vsix --workspace storyboard-vscode -- --out "$PWD/release/storyboard-vscode-${version}.vsix"
tar -czf "release/storyboard-bot-${version}.tar.gz" -C apps/bot dist package.json README.md config.example.json assets
tar -czf "release/storyboard-cli-${version}.tar.gz" -C apps/cli dist package.json
```

## Version commit

The version commit should include at least:

- `package.json` (the version) and `package-lock.json`
- `apps/desktop/package.json`, `apps/bot/package.json`, `apps/cli/package.json`
- `apps/cli/src/index.ts` (the printed version)
- `apps/desktop/CHANGELOG.md`, `apps/desktop/CHANGELOG.en.md`

```bash
git add package.json package-lock.json apps/*/package.json apps/cli/src/index.ts \
  apps/desktop/CHANGELOG.md apps/desktop/CHANGELOG.en.md
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
2. Verifies the tag matches the root version and that all three apps are synced to it.
3. Runs lint and tests from the repository root.
4. Packages three artifacts: `storyboard-vscode-<version>.vsix`,
   `storyboard-bot-<version>.tar.gz`, `storyboard-cli-<version>.tar.gz`.
5. Copies `scripts/install.sh` alongside them and creates `SHA256SUMS` over everything.
6. Builds the release notes from the `## [<version>]` section of `apps/desktop/CHANGELOG.md`
   (with `CHANGELOG.en.md` in a collapsed `English` block). Only that version's entries go into
   the release body; the job fails if the section is missing.
7. Creates a GitHub Release with all four assets and the checksum attached.

## How users install

- **Extension** — download the `.vsix` and install it from VS Code.
- **CLI** — `curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash`.
  The script resolves the latest release, verifies the checksum, unpacks into
  `~/.local/share/storyboard` and links `~/.local/bin/storyboard`. The tarball is a bundled Node
  script, so the machine needs Node 20 or newer.
- **Bot** — unpack `storyboard-bot-<version>.tar.gz`, run `node dist/index.js setup`, then
  `node dist/index.js`.

If the workflow fails, delete the failed tag only after deciding whether the release commit itself
should change.

```bash
git tag -d v0.8.0
git push origin :refs/tags/v0.8.0
```

Then fix the release commit, recreate the tag, and push it again.
