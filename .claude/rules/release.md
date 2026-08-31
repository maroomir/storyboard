# Release (versioned cuts)

When preparing a Storyboard release (version bump, changelog, three artifacts, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match the repo-root **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

The version lives in the **root `package.json`**; `npm run version:sync` mirrors it into `apps/vscode`, `apps/bot`, `apps/cli` and the version the CLI prints, and `node scripts/sync-version.mjs --check` is what the release workflow enforces. Run `npm install` afterwards so the root `package-lock.json` follows. One `v*` tag ships all three artifacts. **`apps/vscode/CHANGELOG.md`** and **`apps/vscode/CHANGELOG.en.md`** stay the source of the release notes — update both in the same change.
