# Release Guide

This guide describes how to publish a Storyboard VSIX to GitHub Releases.

## Prerequisites

- The release branch is ready to publish.
- The extension version lives only in `apps/desktop/package.json`. The root `package.json` is the private
  workspaces manifest and has no `version` field.
- `apps/desktop/package.json`, `apps/desktop/CHANGELOG.md`, and `apps/desktop/CHANGELOG.en.md` contain the
  target version, and the single root `package-lock.json` mirrors it at `packages["apps/desktop"].version`.
- The working tree contains only intentional release changes.

## Local verification

Run the same checks used by the GitHub Release workflow before tagging.

From the repository root:

```bash
npm run compile
npm run lint
npm test
```

From `apps/desktop` (the `--out` path is relative to the extension workspace):

```bash
cd apps/desktop
npm run package:vsix -- --out dist/storyboard-0.1.0.vsix
```

Replace `0.1.0` with the target version.

`@seedcoat/wasm` is bundled into `apps/desktop/out/extension.js` by `compile`; no separate vendor copy step is required.

### `.seed` smoke (after VSIX package)

Before tagging a release that includes seedcoat (v0.4+), run once on the built VSIX (see [`apps/desktop/EXTENSION_QA.md`](apps/desktop/EXTENSION_QA.md) § `.seed` 저장소 아카이브):

1. Install `apps/desktop/dist/storyboard-<version>.vsix` in a clean VS Code window.
2. Open a Storyboard workspace with valid `01-*` scene stems and `editor.scenePrefixDigits: 2`.
3. **보내기** → confirm the unencrypted-file notice and a `.seed` file whose first line is `seedcoat archive v1`.
4. **가져오기** or **동기화** → confirm round-trip without `UNSUPPORTED_FORMAT` or `HASH_MISMATCH` errors.

## Version commit

For `v0.1.0`, the version commit should include at least:

- `apps/desktop/package.json`
- `package-lock.json` (single lockfile at the repository root)
- `apps/desktop/CHANGELOG.md`
- `apps/desktop/CHANGELOG.en.md`

If the release changes user-facing installation or release instructions, include the relevant docs as well.

```bash
git add apps/desktop/package.json package-lock.json \
  apps/desktop/CHANGELOG.md apps/desktop/CHANGELOG.en.md apps/desktop/README.md RELEASE.md
git commit -m "chore: release v0.1.0"
```

## Tag and push

Create an annotated tag from the release commit and push the branch before the tag.

```bash
git tag v0.1.0
git push origin HEAD
git push origin v0.1.0
```

The tag name must match `apps/desktop/package.json`'s version with a leading `v`. `v*.*.*` tags are
desktop-only; other workspaces such as the planned `apps/bot` are not released through these tags.

## GitHub Release workflow

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`.

The workflow:

1. Installs dependencies with `npm ci`.
2. Verifies the tag version matches `apps/desktop/package.json`.
3. Runs lint and tests from the repository root.
4. Packages `apps/desktop/dist/storyboard-<version>.vsix`.
5. Creates `SHA256SUMS`.
6. Creates a GitHub Release with the VSIX and checksum attached.

If the workflow fails, delete the failed tag only after deciding whether the release commit itself should change.

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

Then fix the release commit, recreate the tag, and push it again.