# Release (versioned cuts)

When preparing a Storyboard extension release (version bump, changelog, VSIX, tag):

1. Follow **`.cursor/skills/prepare-release/SKILL.md`**.
2. Match **`doc/guide/release.md`** for the version commit contents, tag shape (`v` + semver), and GitHub Release workflow.

Keep **`package.json`**, **`package-lock.json`**, and **`CHANGELOG.md`** on the same target version before tagging.
