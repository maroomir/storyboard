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

If `.github/pull_request_template.md` exists, follow it exactly.

Otherwise use:

```markdown
## Summary

- ...

## Testing

- ...

## Notes

- ...
```

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
