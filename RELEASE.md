# Release Guide

This guide describes how to publish a Storyboard VSIX to GitHub Releases.

## Prerequisites

- The release branch is ready to publish.
- `package.json`, `package-lock.json`, `CHANGELOG.md`, and `CHANGELOG.en.md` contain the target version.
- The working tree contains only intentional release changes.

## Local verification

Run the same checks used by the GitHub Release workflow before tagging.

```bash
npm run compile
npm run lint
npm test
npm run package:vsix -- --out dist/storyboard-0.1.0.vsix
```

Replace `0.1.0` with the target version.

`compile` copies `@seedcoat/wasm` into `out/vendor/`; the packaged VSIX must include that path for `.seed` import/export to work at runtime.

### `.seed` smoke (after VSIX package)

Before tagging a release that includes seedcoat (v0.2+), run once on the built VSIX (see [`EXTENSION_QA.md`](EXTENSION_QA.md) § `.seed` 암호화 컨테이너):

1. Install `dist/storyboard-<version>.vsix` in a clean VS Code window.
2. Open a Storyboard workspace with valid `01-*` scene stems and `editor.scenePrefixDigits: 2`.
3. **보내기** → confirm progress notification and a binary `.seed` file.
4. **가져오기** or **동기화** with the same passphrase → confirm round-trip without `LEGACY_FORMAT_REJECTED` or missing WASM errors.

## Version commit

For `v0.1.0`, the version commit should include at least:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `CHANGELOG.en.md`

If the release changes user-facing installation or release instructions, include the relevant docs as well.

```bash
git add package.json package-lock.json CHANGELOG.md CHANGELOG.en.md README.md RELEASE.md
git commit -m "chore: release v0.1.0"
```

## Tag and push

Create an annotated tag from the release commit and push the branch before the tag.

```bash
git tag v0.1.0
git push origin HEAD
git push origin v0.1.0
```

The tag name must match `package.json`'s version with a leading `v`.

## GitHub Release workflow

Pushing a `v*.*.*` tag starts `.github/workflows/release.yml`.

The workflow:

1. Installs dependencies with `npm ci`.
2. Verifies the tag version matches `package.json`.
3. Runs lint and tests.
4. Packages `dist/storyboard-<version>.vsix`.
5. Creates `SHA256SUMS`.
6. Creates a GitHub Release with the VSIX and checksum attached.

If the workflow fails, delete the failed tag only after deciding whether the release commit itself should change.

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

Then fix the release commit, recreate the tag, and push it again.