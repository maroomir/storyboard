# Storyboard

Storyboard is an AI-powered fiction IDE extension aiming to plan, draft, review, revise, and assemble a full-length novel inside VS Code.

Korean README: [`README.md`](README.md)

## Features

- Target direction: one-click long-form novel generation IDE (Autonomous Fiction Studio).
- Initialize one workspace folder as one Storyboard project.
- Manage the **Generation Contract**: genre, audience, POV, target word count, prohibitions, style constraints, and quality criteria.
- Run `Storyboard: Generate Novel` for project settings → outline → scene seeds → drafts, review, revision → manuscript assembly, review, and summaries.
- Plan long-form structure with `.storyboard/outline/synopsis.md`, `chapters.yaml`, and `revision-plan.yaml`.
- Manage character and background cards with `character/*.card` and `background/*.card`.
- Use a custom editor for `.card` files and dedicated Characters / Backgrounds sidebars.
- Generate `scene/*.txt` seeds from the outline, then generate `draft/*.md` drafts.
- Generate each scene in four stages — skeleton → dialogue polish → section expansion → machine validation. The skeleton fixes the whole scene's event order, cast, and end state in a single context, so later stages only thicken the prose.
- Validate generated scenes deterministically (no AI): cast not present in the skeleton, foreign scripts, lost dialogue, and length shortfalls are retried with reasons, and anything left is surfaced in the draft's `warnings` frontmatter.
- Carry a story state ledger across scenes (`.storyboard/cache/storyState.md`): established facts, character relations and speech, revealed information, and live motifs accumulate with their scene order and feed the next scene's prompt and continuity check.
- Gate canon facts by reveal time (`revealFrom`), separate from when a fact becomes true (`validFrom`), so a third-act twist is not leaked into early scenes.
- Bound a scene with `endState` and `povCharacter` on the scene card, so one scene does not run into the next scene's territory or cross several characters' interiority.
- Drive draft/scene actions by chatting in the always-visible **Storyboard · Studio** sidebar panel: describe a task, review the proposed action, and approve to run it (generate, regenerate, check, edit).
- Keep previous-draft history (`storyboard.draft.keepHistory`): archive a draft to `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md` before it is overwritten (off by default).
- Insert scene-break separators (`storyboard.draft.sceneBreakEnabled`/`sceneBreakSeparator`): insert a `---` divider or n newlines between scenes when generating a draft (off by default).
- Inject canon facts from `.storyboard/bible/canon.yaml` and run draft continuity checks.
- Auto-extract setting fact candidates from drafts and promote them to canon.
- Update cards from drafts (`updateCardsAfterGenerate`): write detected characters into background cards directly, and extract relation/arc/attribute candidates for review via `Promote Card Candidates`.
- Review and revise individual scene drafts while recording instructions in `revision-plan.yaml`.
- Assemble `manuscript/`, run final review (`REVIEW.md`), write chapter summaries (`SUMMARY.md`), and track foreshadowing (`FORESHADOWING.md`).
- Compare unpromoted candidate facts against `canon.yaml` with `Canon Diff Report`.
- Export the assembled manuscript as Markdown or plain text.
- Visualize character relationships with a relation graph.
- Use `mock`, OpenAI, Claude, Google, and Ollama AI providers.
- Localize extension command titles through `package.nls.json` and `package.nls.ko.json`.
- Watch the Telegram companion bot ([storygram](../bot/README.md)) from the status bar — shows run/sync state, and `Storyboard: Open Telegram Bot Dashboard` opens the loopback operations panel.
- Manage the bot from the settings panel's **Telegram bot** tab — edit allowed chat ids and the default provider, switch the connected workspace with «connect this work», and restart after saving. The token is shown masked only; changing it goes through the wizard.
- Edit the bot config later with `Storyboard: Open Telegram Bot Config File` (JSON Schema validation) and apply it with `Storyboard: Restart Telegram Bot` (launchd).
- Onboard the bot with the `Storyboard: Set Up Telegram Bot…` wizard — verifies the token (getMe), collects allowed chat ids, the workspace path, and the provider, writes `~/.storygram/config.json` (0600), sends a test message, and on macOS offers the launchd autostart install.

The current implementation supports both the manual `scene/*.txt` → `draft/*.md` flow and the one-click long-form generation flow. One-click generation stores resumable stage state in `.storyboard/cache/novel-run.json`; long-manuscript PDF/DOCX export and deeper batch review remain follow-up work. See [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the structure.

## Project Model

```text
.storyboard/project.json
.storyboard/bible/canon.yaml
.storyboard/outline/   # synopsis, chapter/scene plan, revision plan
character/*.card
background/*.card
scene/*.txt
draft/*.md
manuscript/*.md
```

- One workspace folder is one project.
- Project settings are the input contract for autonomous novel generation. Edit audience, target word count, point of view, and prohibitions in the **Generation Contract** tab of `Storyboard: Open Settings`, and check generation readiness there.
- `Storyboard: Generate Novel Outline` writes `synopsis.md` and `chapters.yaml`; `Storyboard: Generate Scene Seeds` derives scene seeds from that plan.
- `.card` files are YAML-based reference cards.
- One `scene/*.txt` file is one scene, written manually or generated from the outline.
- `draft/*.md` files are AI-generated, reviewed, and revised manuscript drafts.
- `manuscript/` contains regenerable chapter files, the volume file (`manuscript.md`), and final review, summary, and foreshadowing reports.

## Run Locally

```bash
npm install
npm run build
```

1. Open the repository root in VS Code.
2. Select `Run Extension` in **Run and Debug**, then press F5.
3. In the Extension Development Host window, open an empty folder.
4. Run `Storyboard: Initialize Project`.
5. Fill the **Generation Contract** in `Storyboard: Open Settings`, then run `Storyboard: Generate Novel`, or manually create cards and scenes from the Characters / Backgrounds / Scenes views.

The default `mock` provider lets you verify the flow without an API key. To use a real provider, save a key with `Storyboard: Set API Key...`.

## Development

| Command | Purpose |
| --- | --- |
| `npm run compile` | Build the extension host bundle |
| `npm run build:webview` | Build the webview UI |
| `npm run build` | Build both the extension host and webview UI |
| `npm run lint` | Run ESLint and webview TypeScript checks |
| `npm test` | Run Vitest tests |
| `npm run package:vsix` | Create a local-install VSIX |

For webview-only changes, run `npm run build:webview`, then run `Developer: Reload Window` in the Extension Development Host.

## Documentation

Public docs live at the repo root as uppercase Markdown files. Extended plans and decision logs are not shipped in the remote repo; maintain a local-only `.doc/` directory when needed.

- [`GETTING_STARTED.md`](GETTING_STARTED.md): writer-facing getting started guide (beginner walkthrough)
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md): product architecture and file model
- [`GUIDE.md`](GUIDE.md): draft editor feature guide
- [`EXTENSION_QA.md`](EXTENSION_QA.md): manual QA checklist
- [`RELEASE.md`](../../RELEASE.md): release process
- [`CHANGELOG.en.md`](CHANGELOG.en.md): changelog (English)

## License

Apache License 2.0 — [`LICENSE`](LICENSE)
