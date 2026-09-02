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
npm install && npm run cli:build && node apps/cli/dist/index.mjs --help
```

## First run

```bash
storyboard init --title "밤의 항해"   # an empty directory becomes a workspace
storyboard setup                      # pick the AI provider (and key) — shared with the extension and the bot
storyboard doctor                     # what is still missing, with the command that fixes it
```

`storyboard` with no arguments prints the grouped command list with these steps at the top;
`storyboard <command> --help` (or `-h`) shows one command's options and examples, and a mistyped
verb suggests the closest real ones. `-v` prints the version.

## Interactive screen

`storyboard` with no arguments at a terminal opens an Ink-based screen: a header with the
workspace and the AI provider in effect, a log where results and progress lines land, and a prompt
that accepts the same verbs as the one-shot CLI. Typing shows matching verbs (Tab completes, ↑/↓
picks, Esc clears), `/help` lists everything, `/doctor` and `/setup <id>` run those verbs, `/quit`
or Ctrl+C leaves. `storyboard tui` opens it explicitly; in a pipe it refuses and points back to the
one-shot form, so agents never end up inside it.

## Use

```bash
storyboard init --title "시그널" --genre "하이틴 로맨스" --audience "10~20대" \
  --pov third-limited --target-words 480000 --chapters 8 --scenes-per-chapter 4
storyboard outline generate
storyboard scene seeds
storyboard scene generate 01-scene-1-1 --force
storyboard scene generate --all
storyboard scene revise 01-scene-1-1
storyboard novel generate
storyboard manuscript assemble && storyboard manuscript review
```

`outline generate` refuses until the contract names a genre, an audience, a point of view and a
target word count, so `init` takes them as flags. `--from <json>` reads the same fields from a file
(a whole `project.json` works too), and flags win over the file. To change the contract later, use
the same inputs on `project set` — keys you leave out keep their current value:

```bash
storyboard project set --target-words 320000 --from contract.json
```

`cards build` and `scene complete` write their proposals. Pass `--dry-run` to see the proposal
without touching the tree. A new card whose name yields no ascii id is reported rather than filed
under a guessed id — create it with `card create background --name "방송실" --id broadcast-room`
and run `cards build` again.

Progress lines go to stderr whenever stderr is a terminal (`--quiet` hides them, `--verbose`
forces them for pipes). Setup failures name the fix: no workspace → `storyboard init`, no provider
→ `storyboard setup`, no key → `storyboard apikey set <provider>`.

`--fallback <id>` keeps a long unattended run alive: when a CLI provider answers "usage limit", the
remaining calls go to that provider instead of the run aborting halfway. The switch is one-way.

`--workspace <path>` picks the workspace (default: the current directory). `--json` puts a single
JSON object on stdout — for failures too (`{"ok":false,"message":…}`), so an agent never has to
parse loose text; progress and warnings always go to stderr. Exit code is 0 on success and non-zero
on failure.

```bash
storyboard scene draft 01-scene-1-1 --json | jq -r .data.path
```

## Config

`~/.storyboard/config.json`, shared with the extension and the bot, overridden per workspace by
`.storyboard/config.json`. Keys are the extension's setting names without the `storyboard.` prefix.
`storyboard config show` prints the effective values with their origin (공통 / 이 작품 / 기본값) and
`storyboard config set <key> <value>` edits them with the same validation the settings panel uses:

```json
{ "defaultProvider": "codex", "tasks": { "sceneDraft": { "provider": "codex", "model": "gpt-5.6-terra" } } }
```

API keys live in `~/.storyboard/secrets.json` at mode 0600, shared by all three apps. `STORYBOARD_HOME`
moves the whole directory. An older install that still has `cli.json` / `cli-secrets.json` keeps
working from them until the shared files exist, and is warned once per run to rename.

## What this app does not do

- **It does not commit.** Files are written; git is yours. (The Telegram bot is the app whose
  invariant is "a save is a commit".)
- **It has no editor chrome.** Inline completion, hover, the `.card` custom editor and the relation
  graph have no terminal form. The capabilities behind the diagnostics providers do, and become
  `check` verbs.

Verb coverage against the extension's command palette is enforced by `test/parity.test.ts`: a
command added to the extension without a CLI verb fails the build.
