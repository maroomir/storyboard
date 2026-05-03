---
name: prepare-release
description: >-
  Prepares a Storyboard VSCode extension release: confirm version, update
  CHANGELOG, run project verification scripts, package when configured, and tag.
  Use when the user asks for a release, version bump, changelog for release, or
  packaging before publish.
---

# Prepare release (storyboard)

Workflow is minimal until packaging and marketplace steps are fully wired. Follow `package.json` scripts; do not invent commands.

## 1. Confirm version

```bash
node -p "require('./package.json').version"
```

Agree the target version with the maintainer before changing `package.json`.

## 2. Update release notes

- Update [`CHANGELOG.md`](CHANGELOG.md) under `[Unreleased]` (or add a dated section after release).
- Keep entries user-facing and concise.

## 3. Verify

From repo root, only run scripts that exist:

```bash
npm run compile
npm run lint
npm test
```

Full bundle (extension host + webview) before packaging:

```bash
npm run build
```

## 4. Package

- This repo uses `npm run package` → `npm run build` (see [`package.json`](package.json)).
- Do not assume `vsce` or marketplace publish until CI, `vsce` config, and publisher metadata are confirmed.

## 5. Tag (after maintainer confirmation)

```bash
git tag "v<version>"
git push origin "v<version>"
```

## Final response

Include: version/tag, commands run, artifact path if any, and any manual publish steps left.
