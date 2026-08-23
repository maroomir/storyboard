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

Write commits with an English subject and a Korean four-label body:

```text
type(topic): Subject

[Issue] N/A
[Problem] 증상
[Cause & Measure] 원인과 조치
[Checking Method] 검증 방법과 결과

Signed-off-by: Maroomir Yoon <maroomir@gmail.com>
```

- Keep the subject at 50 characters or less with no trailing period; `(topic)` is optional.
- Use `feat`, `fix`, `docs`, `test`, `refactor`, `style`, or `chore`.
- Keep all four labels in order and write `N/A` for a label the change does not support.
- Write the body in Korean; state only what the diff supports and never invent a verification result.
- End with the `Signed-off-by` trailer. Do not add `Co-Authored-By` trailers.

## Final Report

Report changed files, implemented behavior, relevant security or configuration notes, verification results, rule updates, and remaining follow-up work. Keep the report concise and specific.
