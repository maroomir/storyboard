# Release Guide

This guide describes how to publish a Storyboard release to GitHub Releases. One tag ships every
app: the VSCode extension, the CLI and the desktop app.

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

The desktop installers are built by the workflow on macOS and Windows runners. On your own machine
you can build the ones for your platform (unsigned unless the signing variables below are set):

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac --workspace @storyboard/desktop   # on macOS (arm64)
npm run package:win --workspace @storyboard/desktop                                  # on Windows
```

Run the release scenario in `apps/desktop/DESKTOP_QA.md` on both platforms before tagging.

## Version commit

The version commit should include at least:

- `package.json` (the version) and `package-lock.json`
- `apps/vscode/package.json`, `apps/cli/package.json`, `apps/desktop/package.json`
- `apps/cli/src/index.ts` (the printed version)
- `CHANGELOG.md`, `CHANGELOG.en.md`

```bash
git add package.json package-lock.json apps/*/package.json apps/cli/src/index.ts \
  CHANGELOG.md CHANGELOG.en.md
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

Installers go from the platform job to the release directly, never through `actions/upload-artifact`.
Artifact storage counts against the account's shared quota and release assets do not, so routing
~600 MB per release through it would fill the quota and block unrelated repositories too.

1. `verify` (ubuntu, Node 20) installs with `npm ci`, checks the tag matches the root version and
   that every app is synced to it, runs lint and tests from the repository root, then opens the
   release as a **draft** with no assets.
2. `desktop` builds the installers on `macos-latest` and `windows-latest` (Node 22):
   `storyboard-desktop-<version>-mac-arm64.dmg` and `.zip`, `storyboard-desktop-<version>-win-x64-setup.exe`,
   their `.blockmap` files and the update feed `latest-mac.yml` / `latest.yml`. Signing is used when
   its secrets exist (below); otherwise the job warns and ships unsigned installers. Each job
   uploads its own installers straight to the draft release.
3. `publish` packages `storyboard-vscode-<version>.vsix` and `storyboard-cli-<version>.tar.gz`,
   downloads the desktop installers back from the draft, copies `scripts/install.sh` alongside and
   creates `SHA256SUMS` over everything.
4. Builds the release notes from the `## [<version>]` section of `CHANGELOG.md`
   (with `CHANGELOG.en.md` in a collapsed `English` block). Only that version's entries go into
   the release body; the job fails if the section is missing.
5. Uploads the remaining assets and takes the release out of draft, so a run that dies partway
   never leaves a half-built release visible.
6. Publishes the same notes and assets to the public repository, `webfic/storyboard`: it copies
   both changelogs and `scripts/install.sh` there, commits, tags and pushes, then creates the
   matching GitHub Release. The step needs the `WEBFIC_RELEASE_TOKEN` secret (a fine-grained PAT
   with `contents: write` on `webfic/storyboard`); without it the step logs a warning and the
   release stays private only. The desktop app's auto-update reads this public release (the
   `latest*.yml` feed), so a release that is not published there never reaches installed apps.

### Desktop signing secrets

| Secret | For |
|---|---|
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (.p12, base64) and its password |
| `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key for notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code-signing certificate (.pfx, base64) and its password |

An unsigned macOS app opens only after right-click → Open and cannot auto-update; an unsigned
Windows installer shows a SmartScreen warning. Both still work.

#### Issuing the macOS secrets

Everything below needs an [Apple Developer Program](https://developer.apple.com/programs/)
membership (paid yearly; an individual account is enough). The certificate and notarization
themselves cost nothing beyond that. `gh secret set` writes to this repository; run it from the
repo root.

1. **Developer ID Application certificate** (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`).
   1. Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate
      Authority…*, saved to disk. This creates the private key in the login keychain.
   2. developer.apple.com → Certificates → **+** → *Developer ID Application*, upload the request,
      download the `.cer` and double-click it into the login keychain.
   3. In Keychain Access, expand the certificate so its private key shows, select **both**, then
      File → *Export Items…* as `.p12` with a password of your choice.
   4. Register the file base64-encoded and its password:

      ```bash
      base64 -i developer-id.p12 | gh secret set MAC_CSC_LINK
      gh secret set MAC_CSC_KEY_PASSWORD   # the .p12 password, when prompted
      ```

2. **App Store Connect API key for notarization** (`APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER`). Without these three the app is signed but not notarized, and Gatekeeper may
   still block the first launch.
   1. appstoreconnect.apple.com → Users and Access → Integrations → *App Store Connect API* →
      *Team Keys* → **+**, role **Developer**. Download the `AuthKey_<KEY_ID>.p8` once — Apple does
      not offer it again.
   2. The **Key ID** and **Issuer ID** are on the same page.
   3. Register the `.p8` as-is (not base64; the workflow writes it back to a file) with the two ids:

      ```bash
      gh secret set APPLE_API_KEY_P8 < AuthKey_<KEY_ID>.p8
      gh secret set APPLE_API_KEY_ID
      gh secret set APPLE_API_ISSUER
      ```

3. **Check**: on the next tag the `desktop` job's *Configure signing* step no longer warns
   `MAC_CSC_LINK is not set`. To verify locally, export the same variables in a shell
   (`CSC_LINK` may be a path to the `.p12`), run `npm run package:mac --workspace @storyboard/desktop`
   and inspect the result:

   ```bash
   codesign -dv --verbose=2 apps/desktop/release/mac-arm64/Storyboard.app
   spctl -a -vv apps/desktop/release/mac-arm64/Storyboard.app   # "source=Notarized Developer ID"
   ```

The certificate expires after five years and the membership every year; a lapsed membership stops
new builds from being signed and notarized but leaves the already shipped ones working.

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
- **Desktop** — download the `.dmg` (Apple silicon `arm64` or Intel `x64`) or the Windows
  `-setup.exe` from the release and install it. Later releases arrive through the app's own update
  banner.
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
