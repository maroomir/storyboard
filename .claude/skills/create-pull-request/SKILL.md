---
name: create-pull-request
description: Create a GitHub pull request for storyboard following project conventions. Use when the user asks to create, open, or prepare a PR.
---

# Create Pull Request

This skill guides an agent through creating a clear PR for `storyboard`.

## Prerequisites

Verify GitHub CLI availability and auth:

```bash
gh --version
gh auth status
```

If unavailable, tell the user to install/authenticate `gh` first.

Check repository state:

```bash
git status --short
git branch --show-current
```

If there are uncommitted changes, ask whether to commit, stash, or leave them out of the PR.

## Gather Context

Determine the base branch:

```bash
git remote show origin | grep "HEAD branch"
```

Review commits and diff:

```bash
git log origin/main..HEAD --oneline --no-decorate
git diff origin/main..HEAD --stat
```

If the default branch is not `main`, replace `main` with the correct base branch.

## Required Information

Infer from commits, branch name, and diff when possible:

1. What changed?
2. Why was it changed?
3. How was it tested?
4. Is there a related issue?

Ask the user for missing critical information.

## PR Body

Use `.github/pull_request_template.md` as the body skeleton. Keep every section and heading; fill
them as follows:

- **요약**: one or two sentences on what changed and why, replacing the HTML comment.
- **반영 내용**: one table row per change, grouped by workspace (`vscode`, `bot`, `cli`, `story-engine`, `story-format`,
  `story-ai`, `story-git`, `docs`, `rules`, `ci`). Derive rows from `git diff origin/main..HEAD --stat`
  and the commit subjects; list the main files in backticks, not every file.
- **배경**: fill `[Problem]` and `[Cause & Measure]` from the commit bodies (same labels as the commit
  convention). Write `N/A` for a label the change does not support.
- **검증**: tick only the scripts that were actually run; put manual checks under **수동 확인**, or
  `N/A` when none were done. Never invent a result.
- **참고**: related issue (`N/A` if none), review hotspots, and follow-up work.

Write the body in Korean except code, paths, and identifiers. Remove the HTML comments from the
final body.

## Create the PR

Use a temporary body file to avoid shell escaping issues:

```bash
gh pr create --title "PR_TITLE" --body-file /tmp/storyboard-pr-body.md --base main
```

For draft PRs:

```bash
gh pr create --title "PR_TITLE" --body-file /tmp/storyboard-pr-body.md --base main --draft
```

## Final Response

After creation, provide:

- PR URL.
- Summary of changes.
- Tests or verification performed.
- Any follow-up actions.
