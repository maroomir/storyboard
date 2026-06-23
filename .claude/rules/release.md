# Release (versioned cuts)

When preparing a Storyboard extension release (version bump, changelog, VSIX, tag):

1. Follow the **`prepare-release`** skill (`.claude/skills/prepare-release/SKILL.md`).
2. Match **`RELEASE.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

Keep **`package.json`**, **`package-lock.json`**, **`CHANGELOG.md`**, and **`CHANGELOG.en.md`** on the same target version before tagging. When updating changelog entries for a version, update both changelog files in the same change.
