# storyboard (CLI)

Storyboard from a terminal. Same engine as the VSCode extension, no editor required — which is what
lets another AI agent (Codex, Claude Code, Gemini) drive a Storyboard workspace.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh | bash
```

The script resolves the latest release, verifies the checksum, unpacks into
`~/.local/share/storyboard` and links `~/.local/bin/storyboard`. The artifact is a bundled Node
script, so the machine needs **Node 20 or newer**.

From a checkout:

```bash
npm install && npm run cli:build && node apps/cli/dist/index.js --help
```

## Use

```bash
storyboard outline generate
storyboard scene generate 01-scene-1-1 --force
storyboard scene generate --all
storyboard scene revise 01-scene-1-1
storyboard novel generate
storyboard manuscript assemble && storyboard manuscript review
```

`--workspace <path>` picks the workspace (default: the current directory). `--json` puts a single
JSON object on stdout; progress and warnings always go to stderr, so the output stays pipeable.
Exit code is 0 on success and non-zero on failure.

```bash
storyboard scene draft 01-scene-1-1 --json | jq -r .data.path
```

## Config

`~/.storyboard/cli.json`, overridden per workspace by `.storyboard/cli.json`. Keys are the
extension's setting names without the `storyboard.` prefix:

```json
{ "defaultProvider": "codex", "tasks": { "sceneDraft": { "provider": "codex", "model": "gpt-5.6-terra" } } }
```

API keys live in `~/.storyboard/cli-secrets.json` at mode 0600. `STORYBOARD_HOME` moves the whole
directory.

## What this app does not do

- **It does not commit.** Files are written; git is yours. (The Telegram bot is the app whose
  invariant is "a save is a commit".)
- **It has no editor chrome.** Inline completion, hover, the `.card` custom editor and the relation
  graph have no terminal form. The capabilities behind the diagnostics providers do, and become
  `check` verbs.

Verb coverage against the extension's command palette is enforced by `test/parity.test.ts`: a
command added to the extension without a CLI verb fails the build.
