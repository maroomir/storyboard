# Release Guide

This guide describes how to publish a Storyboard VSIX to GitHub Releases.

## Prerequisites

- The release branch is ready to publish.
- `package.json`, `package-lock.json`, and `CHANGELOG.md` contain the target version.
- The working tree contains only intentional release changes.

## Local verification

Run the same checks used by the GitHub Release workflow before tagging.

```bash
npm run lint
npm test
npm run package:vsix -- --out dist/storyboard-0.1.0.vsix
```

Replace `0.1.0` with the target version.

## Version commit

For `v0.1.0`, the version commit should include at least:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

If the release changes user-facing installation or release instructions, include the relevant docs as well.

```bash
git add package.json package-lock.json CHANGELOG.md README.md doc/guide/release.md
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