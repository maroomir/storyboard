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
npm run version:sync   # writes it into both apps and the CLI's printed version
npm install            # refreshes the single root package-lock.json (never hand-edit it)
node scripts/sync-version.mjs --check
```

## 2. Update release notes

- Update [`CHANGELOG.md`](CHANGELOG.md) and [`CHANGELOG.en.md`](CHANGELOG.en.md) under `[Unreleased]` (or add a dated section after release).
- Keep entries user-facing and concise.
- Follow [`RELEASE.md`](RELEASE.md) for version commit contents and tagging.

## 3. Verify

From repo root, only run scripts that exist:

```bash
npm run compile
npm run lint
npm test
```

Full bundle (both apps) before packaging:

```bash
npm run build
```

## 4. Package

One tag ships three apps. Reproduce the extension and CLI artifacts locally exactly as [`RELEASE.md`](RELEASE.md) describes: the VSIX from `storyboard-vscode` and `storyboard-cli-<version>.tar.gz`. `scripts/install.sh` rides along and `SHA256SUMS` covers everything. The desktop installers (`storyboard-desktop-<version>-mac-*.dmg/.zip`, `-win-x64-setup.exe`, and the `latest*.yml` update feed) are built by the release workflow on macOS and Windows runners; locally you can only check your own platform with `npm run desktop:package`. Run the release scenario in `apps/desktop/DESKTOP_QA.md` on both platforms before tagging.

Do not assume `vsce` or marketplace publish until CI, `vsce` config, and publisher metadata are confirmed.

## 5. Preflight (mandatory, on the version commit)

Everything the tag would set off on GitHub, run here first; only the upload is left to the workflow:

```bash
npm run release:preflight                # add -- --package to also package and smoke this platform's desktop app
```

It refuses an uncommitted tree, a branch other than `main`, an unsynced version, a tag that already exists and a missing or empty `## [<version>] - YYYY-MM-DD` section in either changelog, then runs lint, the tests, `npm run bvt` and the desktop smoke. **Do not tag until it prints `Preflight passed`.** Fix what it reports, commit, and run it again.

## 6. Tag (after maintainer confirmation)

```bash
git tag "v<version>"
git push origin "v<version>"
```

## Final response

Include: version/tag, commands run, artifact path if any, and any manual publish steps left.
