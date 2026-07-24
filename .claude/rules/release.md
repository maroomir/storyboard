# Release (versioned cuts)

When preparing a Storyboard extension release (version bump, changelog, VSIX, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match the repo-root **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver, desktop-only), and GitHub Release workflow.

Keep **`apps/desktop/package.json`** (the only place the extension version lives), the repo-root **`package-lock.json`** (mirrored at `packages["apps/desktop"].version`), **`apps/desktop/CHANGELOG.md`**, and **`apps/desktop/CHANGELOG.en.md`** on the same target version before tagging. When updating changelog entries for a version, update both changelog files in the same change.
