# Create Pull Request Workflow

Use this workflow when preparing a pull request for `storyboard`.

## Prerequisites

Check tools and repository state:

```bash
gh --version
gh auth status
git status --short
git branch --show-current
```

If `gh` is unavailable or unauthenticated, ask the user to install or authenticate GitHub CLI before creating the PR.

## Gather Context

Identify the base branch:

```bash
git remote show origin | grep "HEAD branch"
```

Review commits and changed files:

```bash
git log origin/main..HEAD --oneline --no-decorate
git diff origin/main..HEAD --stat
```

If the base branch is not `main`, adapt the commands accordingly.

## PR Body

- If `.github/pull_request_template.md` exists, follow it exactly.
- Include summary, motivation, implementation notes, and tests.
- Mention if verification was limited because scripts do not exist yet.

## Create PR

Use a temporary file for markdown body content:

```bash
gh pr create --title "PR_TITLE" --body-file /tmp/storyboard-pr-body.md --base main
```

Clean up the temporary file afterwards.
