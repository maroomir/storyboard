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
- Carry a story state ledger across scenes (`.storyboard/memory/storyState.md`): established facts, character relations and speech, revealed information, and live motifs accumulate with their scene order and feed the next scene's prompt and continuity check. Each entry also records its scene's input, so an entry whose card or scene was edited without regenerating that scene is marked `- [22!]`, dropped from prompts, and reported as a generation warning.
- Gate canon facts by reveal time (`revealFrom`), separate from when a fact becomes true (`validFrom`), so a third-act twist is not leaked into early scenes.
- Bound a scene with `endState` and `povCharacter` on the scene card, so one scene does not run into the next scene's territory or cross several characters' interiority.
- Open a character/background card or a scene/draft and edit it by chatting in the always-visible **Storyboard · Studio** sidebar panel: describe the change, answer a follow-up question when the agent needs one, review the proposed patch with its consistency verdict as a diff, and approve to apply it. Conversations are stored per entity so you can pick one up later.
- Keep previous-draft history (`storyboard.draft.keepHistory`): archive a draft to `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md` before it is overwritten (off by default).
- Insert scene-break separators (`storyboard.draft.sceneBreakEnabled`/`sceneBreakSeparator`): insert a `---` divider or n newlines between scenes when generating a draft (off by default).
- Inject canon facts from `.storyboard/bible/canon.yaml` and run draft continuity checks.
- Auto-extract setting fact candidates from drafts and promote them to canon.
- Update cards from drafts (`updateCardsAfterGenerate`): write detected characters into background cards directly, and extract relation/arc/attribute candidates for review via `Promote Card Candidates`.
- Review and revise individual scene drafts while recording instructions in `revision-plan.yaml`.
- Assemble `manuscript/`, run final review (`REVIEW.md`), write chapter summaries (`.storyboard/memory/summaries.md`), and track foreshadowing (`FORESHADOWING.md`).
- Route the final review's high-severity findings back into the scenes they name, rewrite each once, then review the volume again. Rewritten scenes are listed in `REVIEW.md`.
- Compare unpromoted candidate facts against `canon.yaml` with `Canon Diff Report`.
- Export the assembled manuscript as Markdown or plain text.
- Visualize character relationships with a relation graph.
- Use `mock`, OpenAI, Claude, Google Gemini, xAI Grok, and Ollama AI providers.
- Localize extension command titles through `package.nls.json` and `package.nls.ko.json`.

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
- Project settings are the input contract for autonomous novel generation. Edit audience, target word count, point of view, composition, and prohibitions in the **Generation Contract** tab of `Storyboard: Open Settings`, and check generation readiness there. Choosing a composition creates the continuity threads and narrator cards, and the same tab summarizes what it made.
- Point of view is one of five values (first, first-retrospective, second, third-limited, third-omniscient). Naming a narrator in `narrator/*.card` lets a scene or a chapter pick a different one.
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

Pick a provider before generating: nothing is chosen on a fresh install, and generation is refused until you choose one. Run `Storyboard: Choose AI Provider`, or set `ai.provider.default` in `~/.storyboard/config.json`. Providers that authenticate with a key (`openai`, `claude`, `google`, `grok`) take one through `Storyboard: Set API Key...`, stored in `~/.storyboard/secrets.json` (mode 0600) and shared with the CLI. `mock` invents text for flow checks and needs nothing.

### Why every provider takes an API key

The Claude Code, Codex, and Gemini CLI providers were removed in 0.9.2. Anthropic, OpenAI, and Google all limit a subscription or account login to interactive personal use and direct programmatic or bulk work to API-key authentication — and long-form generation is bulk work. A config file that still names `claude-code`, `codex`, or `gemini-cli` reads as no provider at all and generation refuses until you choose one — the metered replacement bills at a different rate, so the choice stays yours. Set the model with `providers.<id>.model`. Only `ollama` runs without a key, locally.

## Author resource files

Beyond the settings, four things can be edited as files: prompt wording, the craft contract defaults,
the prompt variant rules and what the composition presets build. Put `prompts/<name>.md`,
`craftContract.json`, `promptVariants.json` or `compositionPresets.json` under `~/.storyboard/` (every
work) or a work's `.storyboard/` (that work only, taking precedence) and all three apps generate on top
of them. The bundled originals live in `packages/story-ai/src/ai/prompts/resources/` and each
package's `*.params.json`; CLI `storyboard params show` lists every value in force with its origin.

## Generated text and provider policies

- **Check what the AI asserts.** Drafts, revisions, review notes and story-bible suggestions are
  model output. Treat any factual claim in them (history, geography, medicine, law, real people or
  places) as unverified until you have checked it yourself. If you hand this app to other writers,
  pass this notice on to them.
- **The provider's usage policy applies to the manuscript.** `openai`, `claude`, `google` and `grok`
  each apply their own content rules to what you generate (for example sexually explicit scenes,
  sexual content involving minors, or material that promotes violence). A request that crosses the
  line is refused by the provider, and repeated violations can restrict the API key or the account.
  `ollama` runs on your machine and no such policy applies.

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
