# Storyboard

Storyboard is an AI-powered fiction IDE extension aiming to plan, draft, review, revise, and assemble a full-length novel inside VS Code.

Korean README: [`README.md`](README.md)

## Features

- Target direction: one-click long-form novel generation IDE (Autonomous Fiction Studio).
- Initialize one workspace folder as one Storyboard project.
- Manage the **Generation Contract**: genre, audience, POV, composition, target word count, prohibitions, style constraints, and quality criteria.
- Point of view is one of five values (first, first-retrospective, second, third-limited, third-omniscient). Naming a narrator with a `narrator/*.card` bundle lets a scene or a chapter pick a different one.
- Pick a composition (linear, omnibus, alternating-pov, frame) and the preset creates the continuity threads and narrator cards. In an omnibus, story state, summaries, and memory carry on only within an episode.
- Run `Storyboard: Generate Novel` for project settings → outline → character cards → scene seeds → drafts, review, revision → manuscript assembly, review, and summaries.
- Plan long-form structure with `.storyboard/outline/synopsis.md` and `chapters.yaml`.
- Manage character and background cards as bundles, `character/<slug>.card/` and `background/<slug>.card/` (the header `card.yaml` and the statements `statements.yaml`).
- Read a card in a read-only viewer opened on its `card.yaml` (statements grouped by section, with «텍스트로 열기» to open the files as text and «스튜디오에서 고치기» to edit in the studio), and use the dedicated Characters / Backgrounds sidebars.
- Make cards and scenes from a description through the **+** of the sidebars, which opens the studio. A card's waiting proposals (from the interview, note absorption, or the studio) appear in a «waiting proposals» band where you apply or discard them.
- Generate `scene/*.card` seeds from the outline, then generate `draft/*.md` drafts.
- Generate each scene in four stages — skeleton → dialogue polish → section expansion → machine validation. The skeleton fixes the whole scene's event order, cast, and end state in a single context, so later stages only thicken the prose.
- Validate generated scenes deterministically (no AI): cast not present in the skeleton, foreign scripts, lost dialogue, and length shortfalls are retried with reasons, and anything left is surfaced in the draft's `warnings` frontmatter.
- Carry a story state ledger across scenes (the `state.yaml` of each scene bundle, joined in structure order): established facts, character relations and speech, revealed information, and live motifs are kept per scene and feed the next scene's prompt and continuity check. Regenerating an earlier scene does not leak later state. Each scene also records its input hash, so a scene whose card or scene was edited without regenerating it is marked `stale`, dropped from prompts, and reported as a generation warning.
- Gate card facts (`fact` statements) by reveal time (`revealFrom`), separate from when a fact becomes true (`since`), so a third-act twist is not leaked into early scenes.
- Bound a scene with its `endState` statement, so one scene does not run into the next scene's territory. Point of view follows the narrator card and the scene or chapter that names it.
- Open a character/background card or a scene/draft and edit it by chatting in the always-visible **Storyboard · Studio** sidebar panel: describe the change, answer a follow-up question when the agent needs one, review the proposed patch with its consistency verdict as a card snapshot or diff, and «apply» it. Conversations are stored per entity in the cache database and can be picked up later.
- Run the **interview** inside the studio: open a character or background card, press «인터뷰» in the studio header, and pick among three options how this person (or place) acts in an upcoming scene's event. The pattern of your choices, not the lines, accumulates; only axes past the threshold are distilled into that card's proposals, which you «apply» in the waiting-proposals band (same engine as CLI `card interview`).
- Supplement a draft from cards without regenerating: **Supplement Draft from Cards** (whole text) and **Update Selection from Cards** (selection) blend the updated cards and their facts into the existing draft, with a diff before applying.
- Derive each scene's fact sheet (grounding) from cards — the event (scene title and first beat), the place (first beat's place or the background card), the time (first beat's time), and relations — and inject it into dialogue generation. Nothing is stored or asked of the AI.
- Craft contract (`setting.craftContract`): no explanatory narration, a motif/refrain repeat limit, a stock-expression blacklist, character interiority, action clarity (`actionClarity`), density modulation (`modulateDensity`), and a default length budget are always injected into generation prompts (a built-in default contract, overridable per project). A scene with no target length gets a budget of its seed length × `sceneLengthMultiplier` (default 12, 2,000–20,000 characters).
- Fixed prose conventions: narration in past tense, dialogue in curly double quotes (`“ ”`). They cannot drift within one work, so they are fixed in the three generation prompts instead of living in the contract.
- Keep previous-draft revisions: generation, regeneration, edits, and studio applies always keep the draft in `.storyboard/cache/revisions/<scene uuid>/` (the last ten per scene) before it is overwritten. There is no setting for it.
- Insert scene-break separators (`generation.sceneBreak.enabled`/`generation.sceneBreak.separator`): insert a `---` divider or n newlines between scenes when generating a draft (off by default).
- Inject the facts written on a scene's character and place cards (`fact` statements) and run draft continuity checks.
- **Absorb notes** (`Storyboard: Absorb Notes…`): pick an Obsidian folder or note, a Notion export zip, or a Notion page address; after an estimate and AI sorting, review the plan and the notes move into character, background, and scene cards and a synopsis (same behavior as CLI `notes absorb`). What concerns an existing card stays as proposals on that card; open the card and apply them from the studio's «waiting proposals».
- **Recommend** button on the Characters / Backgrounds sidebars: have the LLM read every `scene/*.card` and `draft/*.md`, find characters and backgrounds that appear in the text but have no card, offer them in a QuickPick, and create the selected ones as new cards.
- **Complete the story**: read only `scene/*.card` and propose ending scenes after the last number without touching existing scenes. Pick a continuous leading part, confirm in a VS Code diff and a final prompt, and they are added.
- **Build cards from scenes**: read `scene/*.card` as the only source of new facts and propose new character and place cards together with enrichments of existing cards. Only the selected items are applied after a diff review; new characters get no profile PNG.
- Review and revise individual scenes with a loop, and keep the revision plan in the cache database.
- Assemble `manuscript/`, run final review (`REVIEW.md`), write chapter summaries (cache database), and track foreshadowing (`FORESHADOWING.md`).
- Route the final review's high-severity findings back into the scenes they name, rewrite them, then review the volume again, repeating while high findings remain up to `revise.loop.maxIterations` rounds. Rewritten scenes are listed in `REVIEW.md`.
- Export the assembled manuscript as Markdown or plain text.
- Visualize character relationships with a relation graph.
- Use `mock`, OpenAI, Claude, Google Gemini, xAI Grok, and Ollama AI providers.
- Localize extension command titles through `package.nls.json` and `package.nls.ko.json`.

The current implementation supports both the manual `scene/*.card` → `draft/*.md` flow and the one-click long-form generation flow. One-click generation stores resumable stage state in the cache database (`.storyboard/cache/storyboard.db`); long-manuscript PDF/DOCX export and deeper batch review remain follow-up work. See [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the structure.

Completing the story and building cards from scenes are manual and not part of the automatic pipeline. If the source scenes, cards, or directory change during review, applying stops and you must propose again. The selection is applied as one VS Code `WorkspaceEdit`, which is not a transaction that survives a process crash.

## Project Model

```text
.storyboard/project.json
.storyboard/structure.yaml   # threads and the scene order of the whole work
.storyboard/outline/         # synopsis and chapter plan (chapters.yaml)
.storyboard/cache/           # git-ignored: storyboard.db (lock, usage, runs, findings, revision plans, sessions), revisions/
character/<slug>.card/       # card.yaml · statements.yaml · memory/<thread>.yaml · profile.png
background/<slug>.card/      # card.yaml · statements.yaml · memory/<thread>.yaml · image
scene/NNN-slug.card/         # card.yaml · statements.yaml · beats.yaml · dialogue.json · state.yaml · summary.md
draft/NNN-slug.md
manuscript/*.md
```

- One workspace folder is one project.
- Project settings are the input contract for autonomous novel generation. Edit audience, target word count, point of view, composition, and prohibitions in the **Generation Contract** tab of `Storyboard: Open Settings`, and check generation readiness there. Choosing a composition creates the continuity threads and narrator cards, and the same tab summarizes what it made.
- `Storyboard: Generate Novel Outline` writes `synopsis.md` and `chapters.yaml`; `Storyboard: Generate Scene Seeds` derives scene seeds from that plan.
- Characters, backgrounds, narrators, and scenes are all `<kind>/<slug>.card/` folders (bundles). `card.yaml` is the header and `statements.yaml` holds statements with their source (personality, speech, facts …); settings facts are `fact` statements on the character and place cards. Do not edit bundle files by hand; change them through the studio, the interview, or CLI verbs.
- A 0.15 work is refused with a «0.15 형식» notice and is not converted. Keep using 0.15.x for it.
- A scene bundle is made from a description in the studio (the **+**) or generated from the outline.
- A scene is one `scene/NNN-slug.card/` folder, and its three-digit number comes from the order in `.storyboard/structure.yaml`. Rename a scene's slug with **Storyboard: Rename Scene...** from the command palette: the scene folder (with its dialogue and state), the draft, the cache, and the studio conversations move together (revisions sit under the scene uuid, so they stay). Renaming never changes the number.
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
5. Fill the **Generation Contract** in `Storyboard: Open Settings`, then run `Storyboard: Generate Novel`, or create cards and scenes by hand from the Characters / Backgrounds / Scenes views.

Pick a provider before generating: nothing is chosen on a fresh install, and generation is refused until you choose one. Use the status bar item or the notice shown on first activation, or set `ai.provider.default` in `~/.storyboard/config.json`. Providers that authenticate with a key (`openai`, `claude`, `google`, `grok`) take one through `Storyboard: Set API Key...`, stored in `~/.storyboard/secrets.json` (mode 0600) and shared with the CLI. `mock` invents text for flow checks and needs nothing.

## Settings files

Storyboard settings are not VS Code settings. They live in **`~/.storyboard/config.json`**, which the CLI reads too. A value you want for one work only goes in that workspace's `.storyboard/config.json`, which overrides the shared value for that work. API keys are in `~/.storyboard/secrets.json` (mode 0600). The `STORYBOARD_HOME` environment variable moves the home.

Keys use the dotted names written in these docs, such as `editor.grammar.realtime`, and the settings panel (`Storyboard: Open Settings`) edits the file. The panel shows where each value comes from (shared / this work / default) and tells you which file each save went to. Generation, review, and editor switches are on the **Options** tab. The `✦ provider · model` status bar item shows the current default AI and opens the settings panel. `storyboard.*` values an older version kept in VS Code's `settings.json` are moved over once on first activation.

```json
{ "ai.provider.default": "claude", "editor": { "grammar": { "realtime": true } } }
```

### Why every provider takes an API key

The Claude Code, Codex, and Gemini CLI providers were removed in 0.9.2. Anthropic, OpenAI, and Google all limit a subscription or account login to interactive personal use and direct programmatic or bulk work to API-key authentication — and long-form generation is bulk work. A config file that still names `claude-code`, `codex`, or `gemini-cli` reads as no provider at all and generation refuses until you choose one — the metered replacement bills at a different rate, so the choice stays yours. Set the model with `providers.<id>.model`. Only `ollama` runs without a key, locally.

## Author resource files

Beyond the settings, five things can be edited as files: prompt wording, the craft contract defaults,
the prompt variant rules, what the composition presets build and the order of the pipeline stages. Put
`prompts/<name>.md`, `craftContract.json`, `promptVariants.json`, `compositionPresets.json` or
`pipelines/{scene,novel}.yaml` under `~/.storyboard/` (every
work) or a work's `.storyboard/` (that work only, taking precedence) and both apps generate on top
of them. The bundled originals live in `packages/story-ai/src/ai/prompts/resources/` and each
package's `*.params.json`; CLI `storyboard params show` lists the tuning values in force with their origin.

## Generated text and provider policies

- **Check what the AI asserts.** Drafts, revisions, review notes and card suggestions are
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

- [`GETTING_STARTED.md`](GETTING_STARTED.md): writer-facing getting started guide (beginner walkthrough, in Korean)
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md): product architecture and file model
- [`GUIDE.md`](GUIDE.md): draft editor feature guide
- [`EXTENSION_QA.md`](EXTENSION_QA.md): manual QA checklist
- [`RELEASE.md`](../../RELEASE.md): release process
- [`CHANGELOG.en.md`](../../CHANGELOG.en.md): changelog (English)

## License

Apache License 2.0 — [`LICENSE`](LICENSE)
