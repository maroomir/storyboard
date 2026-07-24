---
name: prepare-release
description: >-
  Prepares a Storyboard VSCode extension release: confirm version, update
  CHANGELOG, run project verification scripts, package when configured, and tag.
  Use when the user asks for a release, version bump, changelog for release, or
  packaging before publish.
---

# Prepare release (storyboard)

Workflow is minimal until packaging and marketplace steps are fully wired. Follow the scripts in the root `package.json` and in `apps/desktop/package.json`; do not invent commands.

## 1. Confirm version

```bash
node -p "require('./apps/desktop/package.json').version"
```

The extension version lives only in `apps/desktop/package.json`; the root `package.json` has no `version` field. Agree the target version with the maintainer, edit `apps/desktop/package.json`, then run `npm install` from the repo root so the single root `package-lock.json` picks up the new `packages["apps/desktop"].version` (do not hand-edit the lockfile).

## 2. Update release notes

- Update [`apps/desktop/CHANGELOG.md`](apps/desktop/CHANGELOG.md) and [`apps/desktop/CHANGELOG.en.md`](apps/desktop/CHANGELOG.en.md) under `[Unreleased]` (or add a dated section after release).
- Keep entries user-facing and concise.
- Follow [`RELEASE.md`](RELEASE.md) for version commit contents and tagging.

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

- From the repo root, `npm run package:vsix` delegates to the extension workspace (see [`apps/desktop/package.json`](apps/desktop/package.json)); the VSIX is written under `apps/desktop/`.
- Do not assume `vsce` or marketplace publish until CI, `vsce` config, and publisher metadata are confirmed.

## 5. Tag (after maintainer confirmation)

```bash
git tag "v<version>"
git push origin "v<version>"
```

## Final response

Include: version/tag, commands run, artifact path if any, and any manual publish steps left.
