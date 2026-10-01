# Security

Storyboard runs on the writer's own machine. What it holds and touches:

- **API keys** in `~/.storyboard/secrets.json`, written with mode 0600 and never logged. They are
  sent only to the provider the writer chose.
- **The writer's workspace**, a git repository it reads and writes. The CLI and the extension never
  commit; the desktop app records versions with isomorphic-git and never pushes.
- **Author resource files** (`~/.storyboard/prompts/*.md`, `craftContract.json`, …) that change what
  the engine sends to a provider.

A report is in scope when Storyboard could expose a key, write outside the workspace it was given,
run something the writer did not ask for, or be made to do any of that by a crafted workspace file,
card, or provider response.

## Reporting

Use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). If that is not available to you, email the address on
the maintainer's commits with "storyboard security" in the subject.

Please include the version (`storyboard -v`, or the extension or desktop version), the host OS, and
the smallest workspace or file that shows the problem. Do not open a public issue for it.

You will get an acknowledgement within a few days. Fixes ship as a normal release, and the
changelog names the reporter unless they ask otherwise.
