# Agent Workflow

This file carries the reusable agent workflow adopted from `remote-coder`.

## Before Editing

- Confirm the task is within documented product scope.
- State assumptions, tradeoffs, and verifiable success criteria for non-trivial work.
- Inspect nearby code, tests, scripts, and rule files before introducing a pattern.
- Identify security, configuration, subprocess, file-system, and extension/webview boundary risks.
- Decide whether tests, user documentation, or rule synchronization are required.

## Before Finalizing

- Confirm the request is satisfied and unrelated cleanup was not mixed in.
- Add or update tests when behavior changed.
- Run focused verification first, then broader project scripts when shared behavior changed.
- State verification limitations explicitly.
- Update documentation for new settings, commands, configuration, or user-facing behavior.
- Keep `.claude/rules/`, `.cursor/rules/`, `AGENTS.md`, and `CLAUDE.md` synchronized according to their ownership rules.

## Commit Messages

Write commits in English as `type: title`, followed by a blank line and `-`-prefixed body sentences.

- Keep the subject at 50 characters or less with no trailing period.
- Prefer body lines at 100 characters or less.
- Use `feat`, `fix`, `docs`, `test`, `refact`, `style`, or `chore`.
- Do not add `Co-Authored-By` trailers.

## Final Report

Report changed files, implemented behavior, relevant security or configuration notes, verification results, rule updates, and remaining follow-up work. Keep the report concise and specific.
