---
name: prepare-release
description: >-
  Prepares a Storyboard VSCode extension release: confirm version, update
  CHANGELOG, run project verification scripts, package when configured, and tag.
  Use when the user asks for a release, version bump, changelog for release, or
  packaging before publish.
---

# Prepare release (storyboard)

Workflow is minimal until packaging and marketplace steps are fully wired. Follow the scripts in the root `package.json` and in `apps/vscode/package.json`; do not invent commands.

## 1. Confirm version

```bash
node -p "require('./package.json').version"
```

The version lives in the **root** `package.json` and every app mirrors it. Agree the target version with the maintainer, edit the root `package.json`, then:

```bash
npm run version:sync   # writes it into the three apps and the CLI's printed version
npm install            # refreshes the single root package-lock.json (never hand-edit it)
node scripts/sync-version.mjs --check
```

## 2. Update release notes

- Update [`apps/vscode/CHANGELOG.md`](apps/vscode/CHANGELOG.md) and [`apps/vscode/CHANGELOG.en.md`](apps/vscode/CHANGELOG.en.md) under `[Unreleased]` (or add a dated section after release).
- Keep entries user-facing and concise.
- Follow [`RELEASE.md`](RELEASE.md) for version commit contents and tagging.

## 3. Verify

From repo root, only run scripts that exist:

```bash
npm run compile
npm run lint
npm test
```

Full bundle (all three apps) before packaging:

```bash
npm run build
```

## 4. Package

One tag ships two artifacts. Reproduce them locally exactly as [`RELEASE.md`](RELEASE.md) describes: the VSIX from `storyboard-vscode` and `storyboard-cli-<version>.tar.gz`. `scripts/install.sh` rides along and `SHA256SUMS` covers all three.

Do not assume `vsce` or marketplace publish until CI, `vsce` config, and publisher metadata are confirmed.

## 5. Tag (after maintainer confirmation)

```bash
git tag "v<version>"
git push origin "v<version>"
```

## Final response

Include: version/tag, commands run, artifact path if any, and any manual publish steps left.
