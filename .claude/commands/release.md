# Release

Prepare a `storyboard` extension release.

## Overview

This workflow is intentionally minimal until the repository has a finalized packaging and publishing setup.

## Steps

### 1. Confirm Version

Check the current version when `package.json` exists:

```bash
cat package.json | grep '"version"'
```

Confirm the target version with the maintainer.

### 2. Update Release Notes

- Update `CHANGELOG.md` if it exists.
- If no changelog exists yet, ask whether to create one.
- Keep notes user-facing and concise.

### 3. Verify

Inspect `package.json` scripts and run the appropriate checks, for example:

```bash
npm run compile
npm test
```

Only run scripts that actually exist.

### 4. Package

When packaging is configured, use the project-defined command or VSCE workflow.

Do not assume marketplace publishing is configured until `package.json`, CI workflows, and publisher metadata confirm it.

### 5. Tag

After confirmation:

```bash
git tag v<version>
git push origin v<version>
```

## Final Summary

Report:

- Version/tag.
- Verification commands run.
- Packaging artifact, if produced.
- Any manual publishing steps remaining.
