# Changelog

All notable changes to Storyboard will be documented in this file.

Korean changelog: [CHANGELOG.md](CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first public release.

## [Unreleased]

## [0.8.9] - 2026-09-07

### Added

- **Terminal commands for `storyboard-bot`.** `storyboard-bot doctor` checks the config file, workspace, git and providers, and `--help` / `--version` print usage and version. Unlike Telegram's `/doctor` it answers before the bot can start, so a missing or broken config explains itself in the terminal.
- **Canon validity is measured on a story time axis.** Put an integer `storyTime` on a scene card and validity ranges are measured on that axis, so a flashback, frame story, or time jump no longer means "a character who died in chapter 20 is still dead in a chapter 25 flashback." Scenes without one keep using the scene ordinal, and if no fact uses the time axis the scenes are not read at all. Reveal timing (`revealFrom`) stays on the scene ordinal — it is about the order the reader read things — and now takes a `{ scene, knownBy }` form so "A knows, B does not" is expressible: characters who do not know are marked `(not yet known: Jihun)`, preserving dramatic irony.
- **The section expansion output limit is configurable.** Lowering `draft.sectionOutputLimit` (default 7,000) splits the work into more sections, which means more calls and more length. When the target is below the limit, expansion runs only once and length stays stuck near the skeleton's — and the prompt's character-count instruction proved ineffective in practice, leaving nothing to adjust.

### Changed

- **Unknown arguments are refused.** A mistyped command such as `storyboard-bot init` used to be ignored and the bot started anyway, which made a typo look like a configuration failure. It now prints usage and exits 1.
- **A missing config reads as onboarding, not an error.** A first run is not a fault, so it points at `storyboard-bot setup`. A config file that exists but is broken still logs an ERROR as before.
- **Final review now runs one chapter at a time.** It used to put the whole manuscript in a single call, so at two or three volumes the model's attention thinned toward the end and contradictions in the middle went essentially undetected. Each chapter now gets its own continuity and critique pair, carrying the preceding chapters' summaries so contradictions across chapter boundaries stay visible. It no longer depends on a long-context model, so review quality survives a change of provider.

### Fixed

- **Drafts of event-light scenes no longer fall far short of the target length.** The skeleton prompt asked for "no description" and "about N characters" at once; the two instructions conflict and which one wins was down to the model. In practice one model wrote a third of the target, leaving expansion to carry a ninefold stretch, and the final draft came in under half. Length is now explicitly filled by event density rather than description, and a skeleton under half the target is re-requested once with the reason attached.
- **Expansion no longer pads its length by repeating.** With the material exhausted, repetition was the model's only way to reach the target, so a section would restate dialogue the previous one had already broken up and repeat a closing action. The old check only caught a section rewritten wholesale, so smaller repetitions passed. Repetition is now a violation, and a short clean version wins over a long padded one.
- **Splitting a long line into several sentences is no longer mistaken for losing it.** Comparing each fragment against the original meant a split line fell under the threshold and was flagged as missing, burning two retries and leaving a warning on the draft. Consecutive fragments are now compared joined as well.
- **Editing an earlier chapter marks its summary stale.** Nothing recorded which draft a summary came from, so rewriting an earlier chapter left the summary frozen on the old text and the discarded version's plot kept flowing into later chapters' prompts. A stale chapter is not deleted, only excluded from the prompt, and generation warnings plus `doctor` name the chapters to re-summarise.
- **Rewriting an early scene no longer leaks information from later ones.** Character and background memory was reused on the card hash alone, so memory that had evolved through scene 30 was used verbatim while rewriting scene 5. Memory updated after the scene being written is now rebuilt — closing an asymmetry where the ledger had rewind but card memory did not.

### Removed

- **The CLI no longer reads the pre-0.8 `cli.json` / `cli-secrets.json`.** Rename them to the shared `~/.storyboard/config.json` / `secrets.json`, or run `storyboard setup` again.

## [0.8.8] - 2026-09-07

### Added

- **Point of view can change per scene and per chapter.** The contract's point of view now has five values, including first-person retrospective and second person, and a named **narrator card** (`narrator/*.card`) can be selected from a scene card's `narrator` or a chapter's `narrator` in `chapters.yaml`. A narrator carries person, knowledge boundary (witnessed / omniscient / retrospective), tense and voice; resolution runs scene > chapter > project. Projects with no narrator cards keep behaving exactly as before, with one contract-wide point of view. A scene's narrator, thread and focal character take part in the draft cache and the ledger audit, so changing only the point of view regenerates the draft and marks what that scene had established as stale.
- **Choosing a composition writes omnibus, alternating-POV and frame stories.** Picking a composition in the contract makes a preset create the continuity threads and narrator cards, and outline generation receives instructions for that shape (each episode closing on its own, a narrator per chapter, the frame sitting at the first and last chapter). In an omnibus the story-state ledger, chapter summaries, previous-scene context and character memory stay inside one episode; only canon is shared.
- **A first-person or limited narrator no longer states what it could not know.** Every story-state entry now records the characters present when that fact was established, and a witnessed narrator's prompt drops entries its focal character did not witness. Review also gained point-of-view and narrator-voice checks.
- **The CLI gained `narrator` verbs and `scene show`.** `storyboard narrator add|list|show|remove` manages narrators, and `storyboard init --composition omnibus --episodes 4` picks a composition. `scene show <stem>` prints the narration and thread a scene will be generated with, and `doctor` catches dangling narrator references and threads the contract does not declare.
- **`doctor` reports ledger lines it could not read.** A hand-edited tag such as `- [2!!] …` leaves that entry outside both the point-of-view filter and the staleness audit. Doctor now reports how many such lines there are with an example, and it looks at every thread ledger too.
- **`install.sh` can install from tarballs you already downloaded.** Pass `--from <directory>` and it uses the `storyboard-cli` and `storyboard-bot` tarballs there. This covers the case where the repository is private and the script's unauthenticated fetch of the release assets fails with a 404 — download the assets by hand, then install. A `SHA256SUMS` in the same directory is verified; without one the script warns and continues.

## [0.8.7] - 2026-09-07

### Added

- **One `install.sh` line now installs the Telegram bot alongside the CLI.** Previously only the CLI was installed; the bot had to be unpacked by hand, and even then failed to run because `better-sqlite3` — outside the bundle — was missing. Both tarballs are now checksum-verified and unpacked, the bot's runtime dependency is installed, and both `storyboard` and `storyboard-bot` are linked. Follow up with `storyboard-bot setup`. Node 20 or newer plus npm is required.

### Fixed

- **Edited cards and scenes now invalidate the story-state ledger.** Each ledger entry records the input hash of the scene that produced it, so editing a card or a scene without regenerating that scene marks its entries stale; regenerating an earlier scene marks the later ones stale too (rewind). Stale entries stay in the ledger as `- [22!] …` but are dropped from generation prompts, and both the generation warnings and `storyboard doctor` name the scenes to regenerate. Regenerating a scene clears its marks. A pre-0.8 ledger has nothing to compare against, so it is never called stale — `storyboard init --repair` seals it against today's cards and scenes.
- **`npm install` in an unpacked tarball no longer fails with a 404.** The published artifacts carried the source manifest, including `@storyboard/*` workspace dependencies that do not exist in the registry. Each tarball now ships a runtime manifest listing only the external dependencies the bundle actually needs. **`install.sh` refuses versions 0.8.5 and older**, so move to this release or newer if you were installing an old one.

## [0.8.6] - 2026-09-07

### Added

- **Scene cards gain event beats (`beats`), expanded automatically before drafting.** A draft's length is bounded by the event density of its scene card, and a short author summary rarely carried enough events to reach the target word count. `scene generate` now expands beats first when the card has none — from the card's fields, grounding facts and summary (staying inside the summary when there is one) — writes them to the card, and then drafts. The count is `max(draft.minBeats, ceil(targetWordCount / draft.charsPerBeat))` (defaults 5 and 1,500 characters); `draft.autoBeats: false` skips the step. To review beats up front, use the CLI `storyboard scene beats <stem> | --all [--dry-run] [--force]`, the extension command "Storyboard: Expand Scene Beats (Current Scene)", or the bot's `/scene beats <stem> [force]` — existing beats are only regenerated with `--force`/`force`. In the draft prompt, `beats` take precedence over `summary`.
- **Scene summaries move to `scene/<stem>.summary.md`.** The card's `summary` now holds only the file name and the prose lives in the sibling file, keeping the author's events apart from machine-expanded beats. The card editor's Summary field and the bot's `/scene edit|append` read and write that file. `storyboard scene migrate` extracts existing inline summaries into files, and `doctor` warns about scenes that still have an inline summary and scenes without beats. Scenes newly proposed by `scene complete` still come with an inline summary for now; the first edit or `scene migrate` moves it to the file.

## [0.8.5] - 2026-09-07

### Added

- **The CLI recognises and repairs pre-0.8 workspaces.** `doctor` reports missing directories (`draft/`, `scene/`), legacy `scene/*.txt`, placeholder summaries left by the seed factory, a stale `.gitignore` block, and scene cards it cannot parse — one line each, with the command that fixes it. `storyboard init --repair` brings the directories and `.gitignore` of an existing workspace up to date without touching the contract; a plain `init` now refuses an existing workspace. `scene migrate` clears the placeholder line as well as converting `.txt`, keeping whatever summary the author wrote above it.
- **`doctor` checks the login state of subscription CLI providers.** An installed but logged-out CLI is reported as a failure. The check spawns the provider CLI once, so it may take up to about 15 seconds.
- **`scene generate` shows the draft's warnings.** Warnings such as a short draft go to stderr and into `data.warnings` under `--json` (exit code stays 0). With `--verbose`, the pipeline stages (skeleton, flesh-out, review…) are logged to stderr as they run.

### Fixed

- **The claude-code provider now runs as a novelist only.** Tools are disabled and the system prompt is replaced wholesale, so agent phrasing like "I'll write the scene…" no longer leaks into drafts.
- **claude-code failures name their reason.** Instead of only "exited abnormally (exit 1)", the message now carries the reason the CLI gave (usage limit, authentication…), and a failed `doctor` login check appends its cause.
- **One `.gitignore` block definition serves all three apps.** A stale block that has the marker but lacks entries gets the missing lines (`manuscript/` etc.) appended.
- **A single broken scene card no longer stops `doctor` or `scene migrate`.** A card with malformed YAML used to make `doctor` produce no diagnosis at all, and made `scene migrate` die with an exception after the `.txt` conversion, leaving the job half done. Both now report the unreadable file names separately and carry on with the rest.
- **Warnings are printed right after generation.** `scene generate`'s length warning appeared only after the review rewrite had finished, re-reporting a problem that had already been fixed.

## [0.8.4] - 2026-09-07

### Added

- **xAI Grok as a provider.** The `grok` provider talks to xAI's OpenAI-compatible API (`api.x.ai`); the key goes into `~/.storyboard/secrets.json` like any other API provider. The catalog lists `grok-4.6`, `grok-4.5` and `grok-4.3`, with a price table so dollar cost is shown alongside tokens.
- **Gemini CLI as a provider.** The `gemini-cli` provider runs the installed `gemini` command headlessly, like Claude Code and Codex, so a Google account login is all it needs. Models are the `flash`/`pro` aliases or ids such as `gemini-2.5-pro`; usage is read from the CLI's JSON `stats`, and hitting the usage limit follows the same fallback rule as the other CLIs. The connection test only checks the install; a missing login is reported on the first generation.
- **The bot accepts API-key providers.** It used to allow CLI providers only (claude-code, codex, mock) and refused to boot when the shared config named OpenAI, Claude or Gemini. It now reads keys from the shared `~/.storyboard/secrets.json` and generates with any provider; `/doctor` reports whether each provider in use has a key, and `storyboard-bot setup` offers the full list.

### Fixed

- **A CLI provider that hit its usage limit is no longer called again and again.** The switch used to reset on every call, so after the limit was reached every remaining task still re-ran that CLI, got refused, and only then fell back — hundreds of wasted process launches over one long manuscript. The switch now lasts the whole run. Alongside that, a per-minute throttle (`rate limit`, `429`) that clears in seconds is no longer treated as exhaustion; one momentary throttle could previously move the rest of a manuscript onto another model.
- **Totals that mix in subscription-CLI usage are labelled.** The bot's `/usage` and status report summed tokens from providers with no price list as $0, showing less than the real charge while looking like an exact figure.
- **Gemini CLI no longer discards a successful answer.** An authentication-related warning on stderr during a good run made it throw away the response and report a login failure.
- **Generation jobs are not queued for a provider with no key.** Now that the bot accepts API-key providers, a missing key is answered at the command instead of when the job finally runs.
- **The bot setup wizard aborts when no provider is chosen.** Three unusable answers used to settle silently on `codex`; it now stops like every other step.
- **`"sceneDraft": "codex"` in `bot.json` now takes effect.** The shorthand passed the schema but the engine could not read it, so the task quietly fell back to the default provider.
- **The Set API Key command only offers providers that need one.** Storing a key against `ollama` or a CLI provider did nothing.

## [0.8.3] - 2026-09-05

### Added

- **Final full-manuscript review feeds back into the manuscript.** It found long-range contradictions but left them in the `REVIEW.md` report, with no indication of which draft to fix. The review now names a scene for each issue, rewrites only the scenes carrying severe ones, then re-runs the full review and updates the report. Issues that could not be pinned to a scene are counted in the report rather than dropped. A run mode that shows the target scenes and asks for approval before rewriting was added as well (the CLI is unattended and keeps going automatically).

### Changed

- **The "story so far" is refreshed after each chapter.** The rolling summary used to be produced only in the pipeline's final step, so the summary file stayed empty throughout a one-click first run and later chapters were written knowing nothing but the last 1,000 characters of the previous draft. The injection budget also grew from 2,000 to 8,000 characters, and overflow now compresses the oldest chapters to a title and one line instead of truncating the front, so setups planted in the opening survive.
- **AI-built memory moves to `.storyboard/memory/` and is git-tracked.** The story-state ledger, character and background memory, dialogue records, and per-chapter summaries cannot be rebuilt from committed inputs, yet they lived in the ignored `.storyboard/cache/` and so sat outside version control. **Existing workspaces are migrated once, automatically, the first time they are opened** — nothing to do by hand.

## [0.8.2] - 2026-09-04

### Changed (breaking)

- **Settings and API keys move to `~/.storyboard/`, shared by all three apps.** Previously the extension used VS Code `settings.json` and its secret storage, the CLI used `cli.json`, and the bot used `bot.json`, so the same key had to be entered three times. There is now one place: `~/.storyboard/config.json` for shared settings, `<workspace>/.storyboard/config.json` for per-project ones, and `~/.storyboard/secrets.json` (0600) for keys. **On first activation the extension migrates your existing `storyboard.*` settings and stored keys once and removes them from VS Code** — nothing to do by hand, but `storyboard.*` entries no longer appear in the VS Code settings UI; use the settings panel instead. The CLI's old `cli.json`/`cli-secrets.json` and the bot's `bot.json` AI block are still read, with a warning, for now.
- **Generation is refused until an AI provider is chosen.** The default used to be `mock`, so a fresh install produced fake drafts without any choice being made. Now a missing provider stops the run with an error, and the extension offers a «Choose provider» button while the CLI points at `storyboard setup`. Background features such as inline completion, grammar, and continuity skip silently instead of erroring.

### Added

- **The CLI has an interactive screen.** Running `storyboard` with no arguments (or `storyboard tui`) opens a screen headed by the workspace and provider where you can keep entering commands and watch progress and results in place. It supports prefix suggestions (Tab), history, and `/help`, `/doctor`, `/setup`, `/clear`, `/quit`. It refuses to start without a TTY, so an agent can never end up trapped inside it.
- **Shell tab completion.** `storyboard completion <zsh|bash|fish>` prints a registration script that completes commands and options as well as the scene and card names in your workspace. Installing via `install.sh` registers it in your shell's rc file automatically.
- **New `setup`, `doctor`, and `config` verbs.** `setup` gets a new machine's provider and key in place, `doctor` checks the home directory, settings, provider, key, executable, and workspace — **and names the command that fixes each problem** — and `config show|set` shows values along with where they came from.
- **`--help` is worth reading.** Thirty commands are organised into seven groups with examples, `<command> --help` gives per-verb help, and `-h`/`-v` work. A typo suggests the nearest command, and running with no arguments no longer exits with an error.
- **Eight long-running commands now show progress**, with an N/M counter for scene seed generation and legacy scene migration.
- **Failure notifications carry a next action.** A missing API key offers «Open settings» and a missing provider offers «Choose provider», across thirteen call sites. Empty sidebars now show a button instead of a sentence telling you to open the command palette.
- **The settings panel confirms every save and shows where each value comes from.** Saving reports whether it landed in the project or the shared config, and each value carries an origin badge. A new «Options» tab exposes the generation and review switches, and the status bar shows the current default provider and model.
- **The bot reads the shared config too.** A provider chosen in the extension or the CLI now applies to the bot, and `/doctor` reports the provider actually in use.

### Fixed

- **The cost badge no longer reads $0.00 for subscription providers.** Providers with no price table, such as `codex` and `claude-code`, show «12.3k tokens»; priced ones show «$0.42 · 12.3k»; nothing recorded shows «—». Studio conversation usage is now recorded in the ledger as well.
- **Opening a character, background, or scene card no longer disables the Studio chat.** A `.card` file opens in a custom editor, so it was not seen as the active text editor.

## [0.8.1] - 2026-09-04

### Fixed

- **A long scene's later half no longer repeats its earlier half.** Across a 32-scene run, 11 scenes had a second half that copied the first, one of them 18% duplicate. The cause was three-layered and all three are now closed: a skeleton that lays out the same run of dialogue twice is retried with a reason, an expansion that rewrites the previous section is rejected, and a version that dodged the verbatim check by rewording is caught by comparing dialogue order.
- **The last section is no longer asked for length it has no material for.** Section budgets are now split in proportion to the actual length of each skeleton slice instead of evenly, so a thin slice has no reason to pad by repeating what came before.
- **The purpose, conflict, and turn an outline assigns to each scene now reach draft generation.** Previously, generating straight from a scene seed gave the model a single line of material: "this is an auto-generated scene seed."
- **A card build response is no longer discarded when the model writes an unknown value as an empty string.** An empty optional field now reads as absent.
- **A card created from a Korean name no longer gets an unrelated `new-card`, `new-card-2` id.** When no usable id can be derived, the CLI asks for `--id` instead of silently guessing.

### Changed

- **`draft/` is git-tracked in a new workspace.** Drafts are the readable result but had no history and so no point to return to. `.draft/`, `manuscript/`, and `.storyboard/cache/` are rebuildable from them and stay ignored. Existing workspaces keep their `.gitignore` as-is — remove the `draft/` line by hand to track drafts there.

### Added

- **The project contract can fix the chapter and scene counts.** Set `chapterCount` and `scenesPerChapter` and the structure holds across outline regenerations. Previously the only option was to ask for it in prose in the description, where the value was recorded nowhere.
- **The CLI takes the project contract as input.** `storyboard init` accepts contract flags and `--from <json>`, and `storyboard project set` edits them later. Previously the `project.json` written by `init` had no `setting`, so the CLI alone could not reach outline generation.
- **The CLI's `cards build` and `scene complete` now write files.** Use `--dry-run` to see the proposal JSON only; ending scenes skip files that already exist.

## [0.8.0] - 2026-09-03

### Added

- **A `storyboard` command line app.** Create a workspace, create and edit cards and scenes, generate and regenerate drafts, run the three checks (continuity, grammar, canon), and export the manuscript — all from a terminal, with no editor. Results go to stdout, progress and warnings to stderr, and success is reported through the exit code, so another AI agent can drive it directly. Configuration lives in `~/.storyboard/cli.json` (overridden per workspace by `.storyboard/cli.json`); keys are stored in `~/.storyboard/cli-secrets.json` at 0600.
- **One tag now ships three artifacts.** The extension VSIX, the bot tarball, and the CLI tarball are attached to the same release with checksums, and `scripts/install.sh` installs the CLI in one line.

### Changed (breaking)

- **The extension ID changes from `maroomir.storyboard` to `maroomir.storyboard-vscode`.** VS Code treats it as a separate extension, so an existing install must be removed and the new VSIX installed by hand. Command titles (`Storyboard: …`), command IDs (`storyboard.*`), setting keys (`storyboard.*`), and the workspace file format are unchanged. The rename frees the plain `storyboard` name for the CLI executable.

### Removed

- **Every Telegram bot feature is gone from the extension.** The status bar watcher, the settings panel's «Telegram bot» tab, and the four commands `Storyboard: Set Up Telegram Bot…`, `Open Telegram Bot Config File`, `Restart Telegram Bot`, and `Open Telegram Bot Dashboard` no longer exist. The bot is now a fully independent app that owns its own configuration and process lifecycle (`node dist/index.js setup`), and the extension does not know it exists.

### Fixed

- **Bot draft generation no longer misses canon facts and the story-state ledger.** The bot now runs the same generation pipeline as the extension and the CLI, so draft quality no longer depends on which app produced it.
- **Manuscript assembly in the bot goes through the shared pipeline** instead of its own copy.
- **The bot refuses to build an outline on an empty contract** rather than writing an empty outline and reporting success.
- **A bot write that would bypass the commit gate is refused.** Tracked files must go through the mutate gate.
- **The CLI provider's usage-limit fallback is restored.**
- **The file modified-time contract is unified across apps**, fixing a mis-firing bot draft gate.

### Internal

- The repository is now an npm-workspaces monorepo: `apps/vscode`, `apps/bot`, and `apps/cli` share `packages/story-engine`, `story-format`, `story-ai`, and `story-git`, with a single version in the root `package.json` propagated by `npm run version:sync`. All three apps write through the same codecs, so a card edited anywhere serializes to identical bytes.
- Each app has an architecture check enforcing its layer direction and rejecting import cycles, and imports are unified on `@/` inside an app and Node subpath prefixes (`#engine/` and friends) inside a package.

## [0.7.3] - 2026-08-31

### Added

- **Studio conversations now use tools.** In a draft conversation the agent can decide to run a continuity check, grammar check, or a span expansion/condensation/card supplement on its own. Check results are summarised in the chat and also shown as editor squiggles; transform results are rough drafts the agent refines, and they always go through the proposal card (diff → approve). Tools run at most twice per turn.
- **Pin a tool with `/`.** Typing `/` in the composer lists the tools for the open file; picking one pins it as a chip so the agent must use it, with an optional natural-language note appended.
- **Card conversations get their own tools.** Character/background cards offer `/collect` (gather additions from the drafts the card appears in), `/audit` (check the card against the rest of the material), and `/relations` (find dangling references and one-way relations — no AI call). Scene cards offer `/audit` and `/relations`.
- **`/update` builds or fills a card from a pasted description.** It detects character vs background, creates and opens the card when missing (or opens the existing one), and stages a "fill the card from this description" instruction in the composer. Works even with no file open.

### Changed

- **Scene-card conversations can now fill `characters` and `location`.** A long description is structured into fields in one proposal, and only ids that resolve to real cards are accepted — a proposal pointing at a missing card is refused at apply time.

## [0.7.2] - 2026-08-31

### Changed

- **The Studio panel now works as a conversation with whatever you have open.** Open a character or background card, or a scene and its draft, and describe the change you want in plain language. Studio asks a follow-up question when the request is ambiguous and proposes an edit once it is clear. Every proposal shows what it changes and whether it conflicts with existing material, and nothing is written until you review the diff and approve it. The old slash commands and twelve action buttons are gone; pipeline work such as generating or regenerating drafts, grammar and continuity checks, story completion, and building cards from scenes still runs from the command palette and the view headers.
- **Conversations are kept per target.** Opening a card or scene restores its last conversation, and the history icon lists earlier ones to resume. Switching files swaps the chat to that target. Conversations whose edits were applied are kept indefinitely; those that changed nothing age out after ten per target. Renaming a card carries its conversations along.

### Added

- **Character cards can record an arc.** You can ask Studio to lay out how a character changes across the story as stages with a summary and a scene reference in `arc`. State fields such as `description`, `traits`, `voice`, and `desire` stay limited to what is true throughout, so later plot no longer leaks into the generation of earlier scenes.
- **Edits point at what else needs attention.** When a change to one file means another card or scene needs work, the proposal offers a button for that target; pressing it opens the file, starts a new conversation, and stages the suggested instruction in the composer. Approving the proposal records the work against that target, so it appears as a reminder the next time you open it.
- **The consistency check can be turned off.** Disable `storyboard.studio.validation` to skip the extra AI pass that runs for each proposal.

### Fixed

- **A stray character at the end of a model response no longer discards the whole result.** This applies to every task that reads a JSON response.
- **Files changed by another tool are no longer overwritten.** Approving a proposal is refused when the editor or the Telegram bot has changed the file in the meantime. Draft edits also verify the original text at the target range, so a drifted position is rejected rather than applied.
- **Draft history is kept for chat edits too.** With `storyboard.draft.keepHistory` on, the previous draft is archived to `.draft` before a chat edit is applied.

## [0.7.1] - 2026-08-31

### Added

- **A character's earlier lines now guide how they speak.** Storyboard records who says each line in a draft and shows a few of that character's actual lines when polishing dialogue in later scenes, so a character's voice drifts less as scenes accumulate.
- **A recurring location's description now grows.** When a place appears again, the draft of its previous appearance informs the new description, so objects and structures established there carry forward. Previously the first appearance's description stayed fixed until the card changed.

### Fixed

- **A draft written elsewhere is archived before it is overwritten.** Generating over a draft produced by the Telegram bot or edited by hand now keeps the previous version in `.draft` regardless of the history setting. It used to disappear with no way back.
- **Long works no longer forget their early setup.** The story state ledger used to discard its oldest entries past a fixed count; it now keeps everything and selects what to include per prompt. A fact established in act one is consulted again when act three mentions it.
- Interrupted writes no longer leave a truncated file behind.
- Warnings from generation survive the review rewrite instead of being dropped from the draft header.

## [0.7.0] - 2026-08-30

### Changed

- **Scene generation is now skeleton-first.** Instead of writing a scene beat by beat, Storyboard drafts the whole scene skeleton at once, polishes the dialogue voices, then fleshes it out section by section. Events, entrances, and the closing point are settled in one context, so a character no longer arrives twice or re-stages something that already happened. The same scene card now produces a noticeably different draft than before.
- Expanded sections are validated deterministically, without an AI pass: a character the skeleton never had, foreign-script contamination, dropped dialogue, and length shortfalls trigger a retry, and anything left is reported in the draft's `warnings` header.
- The dialogue polish pass only adjusts voice. Turn count and order stay as the skeleton wrote them, so it can no longer pad the scene with lines that merely restate the previous one as a question.
- Persona example lines are no longer copied verbatim into the draft.

### Added

- **A story state ledger.** Each generated scene appends confirmed facts, relationship shifts, revealed information, and recurring motifs to `.storyboard/cache/storyState.md`, which the next scene reads. A fact revealed in an earlier scene is no longer revealed again as if it were new.
- **Reveal gating for canon facts.** Set `revealFrom` to a scene number and the fact stays out of prompts until that scene, so an ending twist cannot leak into early scenes.
- **Scene end state (`endState`) and point-of-view character (`povCharacter`) on scene cards.** The end state is editable in the scene form and leaves everything past that point to the next scene.
- Drafts now surface non-Korean script contamination.
- Scene transitions inside a scene are marked in the draft, and section splits prefer those transition points.

### Fixed

- The review loop discarded every revision of a draft that fell short of its target length — even revisions that made it longer were rejected as too short, so fixes were never adopted.
- The expansion length floor moved from half the target to 85%, so a short section actually triggers a retry.
- A skeleton line the expansion only reworded was reported as dropped dialogue; preservation is now judged by similarity.
- When every retry fails, the least severe attempt is kept instead of the last one, and ties go to whichever landed closest to the target length.
- Manual condensation could never succeed on a draft already under its scene target.
- Characters are recognized by the names they are called in the story, not only by their card name.

## [0.6.4] - 2026-08-25

### Changed

- **Scene seeds are now cards (BREAKING).** `scene/NN-slug.txt` becomes `scene/NN-slug.card` (YAML, `type: scene`), carrying purpose, conflict, turn, emotional shift, foreshadowing, and required setup alongside the four grounding facts as structured fields. Legacy `scene/*.txt` is no longer read, so existing workspaces must run the migration command below first. The `[목적]` block the prompts rely on is still rendered from the card, unchanged.
- Replaced the cramped native modal for scene-fact confirmation with a QuickPick list. Incident, place, relation, and time each get a full-width row, so long sentences are no longer wrapped into an unreadable column, and AI-proposed facts are marked with ✨. Editing now targets a single fact — pick the row (or its pencil button) — instead of walking through all four input boxes in order.
- Scene cards open in the card custom editor too, with a scene form (grounding facts, structure fields, summary) and a scene preview. The collection and AI-history tabs stay entity-only.
- Added `Storyboard: Migrate Scenes to Cards`. After a confirmation prompt it converts existing `scene/*.txt` files to `.card` and deletes the originals, reporting any failures. Labelled `[목적]` blocks map to structure fields and free prose maps to `summary`, losing nothing. In the Telegram bot, `/doctor` reports remaining legacy scenes and `/doctor migrate` converts them in a single commit.
- Added a card-editor panel that asks the AI to fill only the empty structure fields from the scene's summary. Suggestions are reviewed before they are applied, and values you already wrote are never overwritten.

### Fixed

- GitHub Release bodies no longer contain the whole changelog; only the tagged version's section is used as the release notes.

## [0.6.3] - 2026-08-23

### Changed

- The Studio panel now opens on a "current stage" card. Instead of a target chip showing only a file name, one card gathers the scene title, the draft's length, version, last update, and review status, plus the linked character and background cards; before any conversation the panel lists three recommended next steps with the reason for each. The card is re-read after every command, so it follows edits to the files. Conversation, approval, and slash-command flows are unchanged.
- The settings Tasks tab is now an override inbox. Rather than listing all 24 tasks, it shows only the tasks that override the default and adds others on demand through a search picker. Three summary cards at the top report the default AI, connection status, and override count, and clicking one jumps to the matching tab.

## [0.6.2] - 2026-08-23

### Added

- Added the scene grounding fact sheet. Right before a draft is generated, Storyboard settles four facts — incident, place, relation, and time — stores them in the scene frontmatter, and feeds them into the dialogue prompt, so an abstract scene seed no longer runs on metaphor alone. Only empty fields get an AI proposal and hand-written values are always kept; once all four are filled, generation skips the AI call entirely. Review-then-approve is the default, and `storyboard.grounding.autoApprove` accepts proposals automatically to keep generation one-click. The settled facts are part of the scene input hash, so editing them invalidates the draft cache.
- Added the craft contract. Bans on narration asides, a cap on repeated motifs and refrains, a cliché blacklist, an interiority requirement, and a default length budget are now rendered into the generation and formatting prompts on every run. A built-in contract applies with no configuration, and `setting.craftContract` in `.storyboard/project.json` overrides it per project.
- Drafts now carry provenance in their frontmatter. Generate, revise, and format apply stamp the tool (`storyboard@<version>`) along with the resolved provider and model as `generator`, `providerId`, and `model`, so you can tell later which configuration produced a manuscript. The augment and condense diff-preview paths preserve existing provenance keys.
- The Telegram bot (storygram) follows the same flow. It writes drafts through the shared frontmatter codec, stamping `storygram@<version>` plus the provider and model, and fills grounding before generating. A queued job cannot ask Telegram for approval, so `draft.autoGrounding` (on by default) fills and commits; turning it off leaves grounding untouched. Saves are based on the hash read at the start, so a desktop edit to the same scene mid-job makes the bot skip its save.

### Fixed

- Fixed drafts growing without bound for scenes that set no target length. The budget is now derived from the scene seed length × `sceneLengthMultiplier` (default 12), clamped to 2,000–20,000 characters, and `sceneLengthMultiplier: 0` disables it. Generate and revise share the same budget.
- Fixed repeated identical lines and refrains slipping through. The repetition limit previously applied to imagery only and now covers identical lines and refrains as well.
- Fixed grounding proposals exposing card IDs (slugs) instead of resolved character names.

## [0.6.1] - 2026-08-21

### Removed

- Removed the seedcoat `.seed` repository archive feature: the three `Storyboard: Create/Sync/Export Project ... Seed` commands, the explorer `.seed` menu, and the `@seedcoat/wasm` dependency are gone. A project lives in its git workspace itself; there is no separate exchange archive format.
- Removed the leftover scaffolding command `Storyboard: Hello World`.

### Fixed

- Repaired the scene coverage diagnostic harness (`coverageCheck.harness.ts`), which imported pre-restructure paths and could not start.
- Removed two card-rename tree context menu contributions that could never appear on webview views. The explorer right-click and command palette paths keep working.
- Added the missing Korean translation for the `Storyboard: Promote Card Candidates` command title.

### Structure

- Cleaned up unreferenced code and dependencies: deleted unused modules, functions, and types, un-exported internal-only symbols, and dropped unused dependencies such as the bot's `js-yaml`. No user-facing behavior changes.
- Corrected 13 stale pre-restructure file paths in `ARCHITECTURE.md` and other docs.

## [0.6.0] - 2026-08-01

### Added

- Added **storygram**, a Telegram companion bot. It is a resident bot that edits the **same** workspace the extension opens, so while away from the desk you can read drafts (`/read`), create and edit scene seeds (`/scene`), edit cards, and queue draft generation with live progress. Every successful save is a commit, and each write re-reads its target immediately beforehand, so editing from the bot and the extension at the same time never overwrites the other side's changes.
- Added the `Storyboard: Set Up Telegram Bot…` onboarding wizard. It validates the token against Telegram first, then collects allowed chat IDs, the workspace, and the default provider, and writes `~/.storygram/config.json` with mode 0600. Picking a folder that is not initialized yet runs Init in place and continues the wizard; on macOS it installs dependencies, builds, and registers launchd with progress reporting, then confirms the bot actually responds and opens the dashboard. The token never reaches logs or error messages.
- Added a status bar item showing bot state (not configured, unobservable, stopped, running) and the `Storyboard: Open Telegram Bot Dashboard` command for the loopback operations panel. Clicking the not-configured state starts the setup wizard.
- Added ways to change the bot configuration after setup. The **Telegram Bot** tab in the settings panel edits allowed chat IDs and the default provider, and «Connect this project to the bot» switches the workspace the bot watches. `Storyboard: Open Telegram Bot Config File` opens the file in an editor backed by JSON schema validation (completion and typo checks), and `Storyboard: Restart Telegram Bot` restarts through launchd and confirms health. The token is shown only as a masked hint and can be changed only from the wizard.

### Fixed

- Fixed cards with `role: support` being silently demoted to `extra` instead of `supporting`, which affected canon injection and how the generation pipeline treated those characters.
- Fixed unknown role values (`주연`, `Main`, …) being silently demoted to `extra` and losing the original value on the next save. Only case and known aliases are corrected now; anything still unknown surfaces in the Problems panel with the offending field and reason.
- Fixed synopsis values containing markdown markers (`## `, `- `, `_미작성_`) or newlines being truncated or split apart across a save and reload.
- Fixed a single malformed synopsis field resetting the whole synopsis to empty. Valid fields are preserved now and only the malformed field falls back to its default.
- Fixed case-insensitive path classification, which routed files such as `SCENE/01.TXT` to the scene parser only to have it reject them.

### Structure

- Rearranged the repository into an npm-workspaces monorepo. The extension moved to `apps/vscode`, and the workspace file format (`@storyboard/story-format`), the AI engine (`@storyboard/story-ai`), the scene generation pipeline (`@storyboard/story-pipeline`), and the git sync layer (`@storyboard/story-git`) became shared packages. User-facing extension behavior and the VSIX contents are unchanged.
- The bot lives at `apps/bot` and consumes the same codecs and pipeline as the extension, so a save from either side writes identical bytes.

## [0.5.2] - 2026-07-24

### Added

- Added manual **Complete Story** and **Build Cards from Scenes** workflows. Command Palette, Studio, and the relevant sidebar headers invoke the same use cases through AI proposal, selection, native VS Code diff, confirmation, and apply.
- Completion appends only new `scene/*.txt` files after the final number. Card building uses scenes as the only source of new facts, proposes new cards and field-level enrichments together, and supports selective alias and tag updates.
- Studio conversations are now persisted per session under `.storyboard/cache/studio-sessions/`. Reopening the view restores the latest session, and a recent-session list (last 20 kept) lets you reopen past conversations or start a new one.
- Added slash commands to the Studio composer. Typing `/` autocompletes commands for the current target, and a selected slash command runs immediately without the approval step.
- Added **draft condensation** to Studio. It shortens a draft toward configurable limits and applies only after VS Code diff review. Invalid or too-short automatic revision output preserves the existing draft, and over-fragmented situations are merged to reduce repeated generated scenes.
- Card files violating the schema (`character/*.card`, `background/*.card`) now appear in the Problems panel with field-level error locations. Previously such cards were silently dropped from scene generation.
- Added optional `targetWordCount` (positive integer) to scene frontmatter. When set, the genre-format stage receives a per-scene target length directive.
- Added the `storyboard.providers.codex.reasoningEffort` setting. An empty value falls back to the CLI default.
- Added the GPT-5.6 Codex models (Sol, Terra, Luna) to the model catalog, with Sol as the default codex model.
- Improved the headless harness: per-task token usage summary at the end of a run, per-scene background attachment logs with a warning when attachment fails, `SCENE_CLI_TIMEOUT` to override the CLI timeout (default 600s), and `SCENE_EFFORT` to set codex reasoning effort.

### Fixed

- Fixed codex CLI output being decoded per chunk, which corrupted multibyte characters into U+FFFD replacement characters at chunk boundaries. Output is now buffered and UTF-8 decoded once at process exit.
- Fixed the draft review and rewrite stages losing character voice: neither stage received the scene's character cards, so project quality guidelines could override card voices. Both stages now receive the cards and prioritize card voice.
- Fixed the Studio webview demoting project targets to none.
- Fixed valid but undersized manual condensation results being rejected instead of routed to diff review.
- Fixed headless harness runs failing on stale import paths left over from the architecture reorganization.

### Safety

- The feature verifies SHA-256 snapshots of proposal inputs and targets immediately before apply. Any review-time change stops the operation for regeneration rather than rebasing or overwriting. Apply uses one `WorkspaceEdit`, not a crash-proof transaction.

## [0.5.1] - 2026-07-19

### Changed

- Reorganized the extension host into bootstrap, application, domain, infrastructure, and presentation layers while preserving extension behavior. Added architecture-boundary checks and use-case coverage to make future changes safer.

## [0.5.0] - 2026-07-04

### Added

- Added the always-visible **Storyboard · Studio** sidebar panel. It auto-detects the active `draft/*.md` or `scene/*.txt` and runs draft regeneration, grammar/continuity checks, card-based supplementing, selection expand/update, instruction editing (Edit Selection input), and scene draft generation/format from one place. The buttons stay visible while scrolling, and the panel header can be moved to the right Secondary Side Bar.
- Added scene-break separators between scenes during draft generation. Enable it with `storyboard.draft.sceneBreakEnabled` and choose a `---` divider or a newline repeat count (1-10) with `storyboard.draft.sceneBreakSeparator`; off by default. Enabling it runs the genre-format AI call per scene, increasing the number of calls, and changing the setting regenerates without cache on the next Generate Draft.

### Changed

- Removed the draft/scene top CodeLens buttons that scrolled away with the document and moved the same actions into the Studio panel. The same actions remain available from the command palette.

## [0.4.4] - 2026-06-30

### Added

- Added card-based supplementing that folds the current cards and canon into an existing draft without regenerating it. The draft CodeLens `✨ Augment from Cards` supplements the whole body and `🪄 Update Selection` supplements only the selected range, while preserving the existing flow, prose style, and manual edits. A native VSCode diff previews the before/after and changes apply only after you click **Apply**; when `storyboard.draft.keepHistory` is enabled the previous draft is archived to `.draft` history first.
- Added instruction-based selection editing. Clicking `✏️ Edit Selection...` in the draft CodeLens opens an input box where you can type a revision direction (e.g. "more tension", "shorter", "emphasize the character's emotion"). The AI rewrites the selected range following the instruction, informed by current cards and canon, and uses the same diff preview and Apply flow.
- Improved draft inline completion so it can use the linked scene file's intent, active characters, and background. Character voice and background description are summarized into the prompt, and scene context is cached briefly to avoid repeated file I/O while typing.

### Fixed

- Fixed the augment diff preview using the real draft file as the before side, which could let VSCode auto-save or CodeLens actions interfere during review. Both before and after documents are now read-only virtual documents, and the real draft changes only after the user clicks **Apply**.

### Tests

- Added coverage for draft-augment prompts, instruction-based selection editing, AI service augment calls, and inline-completion scene-context formatting.

## [0.4.3] - 2026-06-28

### Added

- Added a **Recommend** (✨) button to the Characters and Backgrounds sidebar headers. Clicking it scans all `scene/*.txt` and `draft/*.md` files across the project, uses the LLM to find entities that appear in the text but have no card yet, and presents them in a multi-select QuickPick. Only the selected items are created as minimal card files. Names and aliases already registered in existing cards are excluded from suggestions.

### Fixed

- Fixed recommended cards with non-ASCII names (e.g. Korean) getting meaningless filenames like `background-2` or `background-3`. A file-ID input box now appears so you can specify the ID directly.

## [0.4.2] - 2026-06-28

### Added

- Added a **Collect** tab to the card editor. From `character/*.card` and `background/*.card`, it scans matching `draft/*.md` files, asks the LLM for card-enrichment proposals, and applies only the items selected by the user back to the card YAML.
- Added shared card-collect proposal types and apply logic. Character proposals cover attributes, relations, arcs, traits, recent dialogue, description, voice, and desire; background proposals cover description, senses, time, weather, and characters.
- Added the card-collect AI builder and `backgroundFactExtraction` task. Proposals are accumulated per scene, deduplicated, and shown as updates when an existing keyed value would change.
- Added `cards.collect`, `cards.applyCollect`, and `cards.previewCollect` RPC messages and wired them into the card custom editor provider.
- Added a preview flow that opens the selected collect proposals in VSCode's native diff editor against the current card YAML.

### Fixed

- Fixed collect diff previews opening through the card custom editor route because the virtual preview document kept the `.card` extension.
- Fixed alias-only character mentions being missed by collect extraction. Dialogue and narration that use aliases or titles now contribute to the relevant character's proposals.

### Documentation

- Documented the card-editor Collect tab, proposal review, diff preview, and selective apply flow in README and the writer guide.

### Tests

- Added and updated coverage for card-collect proposal types, add/update filtering, apply logic, background extraction, character description/voice/desire collection, alias-based collection, and messaging registry entries.

## [0.4.1] - 2026-06-27

### Added

- Added the draft-history option `storyboard.draft.keepHistory` (off by default). When on, Generate/Regenerate archives the previous draft to `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md` just before overwriting `draft/<scene>.md`. `.draft/` is gitignored like `draft/`.
- Added a card-candidate flow that extracts per-character attributes, relations, and arc candidates from generated drafts into `.storyboard/cache/cards/`. It runs when `storyboard.draft.updateCardsAfterGenerate` is enabled, and `Storyboard: Promote Card Candidates` lets users choose which candidates to apply to character cards.
- Added `storyboard.draft.verifyCardCandidates` (on by default). Extracted candidates are checked against the draft body again so only explicitly supported candidates remain pending promotion.
- Added character `desire` lists and background `aliases`, `time`, `weather`, and `senses` fields. Persona generation and background-description prompts now use these fields as context.
- Scene context now detects a background card from background names or aliases in the scene body when frontmatter has no `location`.
- Draft generation can add detected characters to the linked background card's `characterIds`.

### Changed

- Character `voice`/`description` and background `description` are now entered as **item lists (`string[]`)** instead of long prose. Manage items in the card editor; they serialize to YAML sequences.
- Added the `Storyboard: Migrate Card Text Fields to List` (`storyboard.cards.migrateTextToList`) command to convert legacy prose cards into line-based lists.
- Split manual card-editor inputs from AI-managed candidate, relation, and arc data. Relations, arcs, and attributes now fit the draft-to-candidate-to-promotion flow.
- Expanded the behavior and description of `storyboard.draft.updateCardsAfterGenerate`. In addition to traits and recent dialogue, it can link background characters and extract card candidates.
- Character `attributes` now feed persona cache keys and persona-generation prompts.
- Guerrila harness regeneration now archives the prior draft into `.draft/` history.
- `npm run lint` now also typechecks the extension-host `tsconfig.json`.

### Fixed

- Scene caches now invalidate correctly when character `voice`, `description`, or `attributes`, and background `description` or `senses`, change.
- Promoted card candidates are removed from the candidate cache, and fully applied candidate files are deleted.
- Local development `TODO.md` is excluded from Git and VSIX packages.

### Documentation

- Updated README, architecture docs, manual QA docs, and the card-parameter impact report for card-candidate promotion, draft history, list-based card fields, background detection, and the new card fields.
- Updated the card/scene format skills for list-based card text fields and draft-history behavior.

### Tests

- Added coverage for card-candidate extraction, verification, promotion, and cache pruning; background character auto-updates; card-text migration; draft history; background detection; card schemas; and scene-cache invalidation.
- Updated regression coverage for manual card-editor fields, YAML editing, Seed import/remapping, and persona/background prompt behavior.

## [0.4.0] - 2026-06-25

### Added

- Added card-scoped memory for character personas and background atmospheres under `.storyboard/cache/personas/` and `.storyboard/cache/backgrounds/`. Card changes invalidate the cache through `cardHash`.
- Added the `backgroundDescription` AI task. It generates place/period atmosphere and sensory details from background cards and feeds them into scene dialogue context.
- Added deterministic review-issue routing to the `canon`, `persona`, and `narrator` agents. Voice issues are scoped to a character card when name/alias matching is unambiguous, while global issues keep the existing full-rewrite path.
- Added the `/scene-quality` workflow and scene-quality rubric docs covering the coverage gate, narrative/connectivity/delineation/transition axes, and six-dimension quality score.

### Changed

- `storyboard.draft.reviseAfterGenerate` now defaults to `true`. Generate / Regenerate / Generate All automatically continue into the review-and-revise loop so one action produces a reviewed draft.
- Added `timeoutMs` settings for Claude Code and Codex CLI providers and raised the default generation timeout to 10 minutes.
- Split the scene-generation pipeline, novel pipeline, draft-generation commands, AI provider construction, settings view, and messaging contracts into smaller stages and modules. User behavior is preserved while testable boundaries are clearer.
- Reduced duplication in Codex JSONL parsing, persona-line construction, AI response coercion, revise-after-generate gating, and Seed file I/O.

### Documentation

- Updated the architecture docs with the multi-agent collaboration model, card-scoped memory, review feedback routing, and setting-agent background description flow.
- Updated the writer guide for the new default automatic review-and-revise behavior after draft generation.
- Added a report on which card parameters actually affect draft-generation quality.
- Reorganized Claude/Cursor rules and skills around `.claude/` as the canonical source and synchronized Cursor mirrors.

### Tests

- Added tests for card-memory serialization and validation, persona cache reuse and invalidation, background atmosphere cache, review routing, settings snapshots, CLI timeouts, and messaging-registry splitting.
- Expanded scene-generation pipeline and revise-workflow coverage.

## [0.3.3] - 2026-06-24

### Added

- Added `aliases` and `voice` fields to character cards. Scene body character detection and per-situation persona scoping now recognize aliases as well as canonical names.
- Added a style directive that combines scene `relationStage` frontmatter with project POV, genre, and style constraints. Persona generation, dialogue generation, genre formatting, and draft critique prompts now use it.
- Added the `sceneCoverage` AI task and `StoryboardAIService.checkSceneCoverage`. It reports missing or out-of-order source beats from a draft as JSON and can summarize the result.
- Added a separate Vitest harness configuration and scripts for running long-form scene generation and scene coverage checks through real CLI providers.

### Changed

- Scene generation now passes only the personas for characters participating in each situation, and later situations receive the generated dialogue tail instead of the previous raw situation text.
- Situation extraction, dialogue generation, and genre-formatting prompts now emphasize preserving all beats while dramatizing transitions, actions, interiority, and conflict as full scenes.
- Final scene formatting is split into character-budgeted chunks for long scenes. If the model returns meta guidance about length limits or output options, the pipeline keeps the raw dialogue chunk out of the manuscript instead.
- Character card updates after draft generation are now off by default and run only when `storyboard.draft.updateCardsAfterGenerate` is enabled.

### Documentation

- Updated architecture examples with character `voice` and scene `relationStage` frontmatter.

### Tests

- Added tests for alias-based character detection, style directives, scene coverage parsing and summaries, prompt instructions, and scene-generation persona scoping, context chaining, and chunked formatting.

## [0.3.2] - 2026-06-22

### Added

- Added `validFrom` / `validUntil` validity ranges and `keywords` activation to story bible canon facts. Scene generation injects only the canon version valid for the scene order, and keyword matches can activate related facts even when their subject is not a scene entity.
- Added `Storyboard: Slop Check (Draft)` and the optional `storyboard.slop.realtimeEnabled` setting. Draft diagnostics now flag cliche phrases, "not just X but Y" style contrast patterns, and over-repeated three-word expressions.
- Added `storyboard.draft.reviseAfterGenerate`. When enabled, newly generated drafts from `Generate Draft` / `Generate All Drafts` run through the existing continuity-and-critique revise gate.
- Added `storyboard.draft.reviseScoreThreshold` and a deterministic critique rubric score. The revise loop can pass early when the score meets the threshold and no high-severity continuity issue remains, and final review reports now include `비평 점수: NN/100`.
- `Storyboard: Canon Diff Report` now includes a canon change timeline for subject/key pairs that have multiple time-scoped versions.

### Changed

- Scene generation now prefers the rolling summary in `manuscript/SUMMARY.md` (up to 2000 characters) as previous-scene context for scene order 2 and later. If the summary is missing or empty, it falls back to the previous 1000-character draft tail.
- Continuity-check results now carry `high` / `low` severity. Only `high` continuity issues block revise loops, and realtime diagnostics render `high` as Warning and `low` as Information.
- Promoted bible candidates now seed `validFrom` from a resolvable `sourceScene` and receive an id that distinguishes later versions of the same subject/key.
- The Codex CLI provider default model is now `gpt-5.5`, and legacy `gpt-5-codex` settings fall back to the current catalog default.
- Codex CLI usage now records token usage with `0` USD cost to reflect ChatGPT subscription-based authentication. The previous gpt-5-codex API-rate cost estimate was removed.

### Fixed

- Codex CLI JSONL failure events are surfaced as the generation failure message instead of showing only a generic non-zero exit code.

### Documentation

- Updated README, architecture, writer guide, and manual QA docs for canon keyword injection, rolling-summary context, revise score thresholds, and Codex cost recording.

## [0.3.1] - 2026-06-22

### Added

- Added Claude Code (`claude`) and Codex (`codex`) CLI providers. They generate via each CLI's own login (subscription) with no API key, and their command path and model are editable in settings and the **Connection** tab.
- The connection test distinguishes a missing CLI binary (`ENOENT`) from other failures and reports it as "CLI not installed".
- Claude Code cost is recorded from the CLI's reported `total_cost_usd`, and Codex usage is parsed from `codex exec --json`. The Codex cost is an estimate at gpt-5-codex API rates, not an actual charge.

### Changed

- CLI providers deliver the full result at once instead of live token streaming, and inline completion is disabled for CLI providers.
- CLI providers do not apply `temperature` or output token limits (`maxTokens`) because those controls are not exposed by the underlying CLIs.

### Fixed

- Claude Code and Codex connection tests now verify login state as well as CLI executability.
- Custom CLI commands that exit before consuming stdin no longer stop the extension with an `EPIPE` error.
- Codex `--json` event parsing is more robust, and empty usage events no longer overwrite earlier usage with zeroes.

### Documentation

- Documented CLI provider support, authentication, cost estimates, and streaming/inline-completion limits in README and architecture docs.

## [0.3.0] - 2026-06-21

### Added

- `Storyboard: Generate Novel` runs the full pipeline in one click — project settings → outline → seeds → per-chapter drafting and review → assembly → review → summaries — and can resume by stage.
- `Storyboard: Canon Diff Report` (`storyboard.bible.canonDiff`) compares not-yet-promoted candidate facts against `canon.yaml` and writes `manuscript/CANON.md`.
- `Storyboard: Export Draft…` (`storyboard.draft.export`) exports the assembled manuscript to Markdown or plain text. (PDF/DOCX to follow.)
- Review-and-revise results and instructions are now accumulated per scene in `.storyboard/outline/revision-plan.yaml`.
- Added `styleConstraints` and `qualityCriteria` to the generation contract, editable in the **Generation Contract** settings tab. These fields are also fed into draft critique prompts.
- `chapters.yaml` now stores chapter- and scene-level target word counts (`targetWordCount`).
- Outline-derived scene seeds now include conflict, twist, needed canon, and target word count details.
- Introduced an extension UI i18n (l10n) mechanism (`package.nls.json` / `package.nls.ko.json`) and externalized all command titles.

### Changed

- The Scenes sidebar shows an "outline" stale badge when `chapters.yaml` is newer than a scene.

## [0.2.4] - 2026-06-18

### Added

- Added the story bible domain and file I/O so work-level canon and settings can be stored and loaded in the workspace.
- Injects story bible canon into scene-generation prompts.
- Added a continuity-check AI task.
- Surfaces continuity diagnostics on drafts and adds a draft CodeLens action to run continuity checks.
- Added a bible-candidate fact store and a setting-fact extraction AI task.
- Auto-extracts bible candidates after draft generation and adds a command to promote candidates into canon.
- Background card forms can edit related characters (`characterIds`).

### Documentation

- Documented the story bible, continuity checks, and bible-candidate promotion flow.
- Added a writer getting-started guide (`GUIDE.md`).
- Reframed the product plan from an author-assist fiction IDE toward a **one-click long-form novel generation IDE / Autonomous Fiction Studio**, updating `ARCHITECTURE.md`, README files, and the agent rule summary consistently.

## [0.2.3] - 2026-06-14

### Changed

- Migrated `.seed` import/export to the `@seedcoat/wasm` v0.4.0 repository-engine API (`load`/`checkoutSnapshot`, `init`/`note`/`save`). `.seed` files are now unencrypted portable archives (`seedcoat archive v1`) that preserve the full change history.
- Removed passphrase prompts and encryption/decryption progress notifications from import/export. Exporting shows a one-time unencrypted-file notice.
- Replaced seed error messages to match the new error-code set (11 codes such as `UNSUPPORTED_FORMAT` and `HASH_MISMATCH`).
- `@seedcoat/wasm` is now a pure TypeScript package and is bundled directly into the extension. Removed the `out/vendor` copy step (`scripts/copy-seedcoat.mjs`) and the dynamic-import loader.

### Removed

- Dropped support for old encrypted `.seed` files (seedcoat v0.2). Such files are rejected as an unsupported format and must be re-exported in the v0.4 format by the sender.

## [0.2.2] - 2026-05-28

### Added

- Added character card role metadata (`protagonist` / `supporting` / `extra`) to the schema and editor UI.
- Grouped the Characters sidebar by role (protagonist, supporting, extra, uncategorized), with collapsible sections and per-group counts.
- Added card game–style framing on `StoryboardCard` in the editor preview, with role badges (main / supporting / extra) using distinct colors and glyphs.
- Added a raw YAML editor panel to the card editor. It reports validation errors before saving and refreshes the card data after a successful save.
- Added a character relation preview panel so character arc flow and relation lists can be reviewed directly in the card editor.
- Added roster lookup for relation displays so related character IDs can be shown with character names and role metadata.

### Changed

- Replaced Overview field add/remove text buttons (List, Arc, Relations, Key-Value) with compact `+` / `-` `IconButton` controls.
- Extracted the card preview area into `PreviewPanel`, separating card editor content from preview rendering.
- Cleaned up Arc and Relations array editing flows and aligned their data shape with the relation preview.
- Removed unused character relation sample path creation from the initial project template and path conventions.

## [0.2.1] - 2026-05-24

### Fixed

- Explorer F2 renames no longer skip updating the card body `id`; text edits now target `oldUri` so they apply before VS Code moves the file.
- Sidebar and command-palette **Rename ID** no longer call `fs.rename` alone (which bypassed reference and profile updates); they now use `workspace.applyEdit` with `renameFile` so the same participant pipeline runs.

### Added

- Renaming a `*.card` file in the explorer updates the card body `id`, references in other cards, and the character profile image when present. Sidebar **Rename ID** commands (`storyboard.character.rename`, `storyboard.background.rename`) use the same pipeline.
- After Seed import or sync, an optional **Review ID mapping** QuickPick lets you assign new card IDs before writing files. Choosing **Continue without changes** preserves the previous behavior.

## [0.2.0] - 2026-05-22

### Changed

- Moved the `doc/` tree to an untracked `.doc/` folder (not shipped in the public repo) and consolidated public docs at the repo root as `ARCHITECTURE.md`, `STORYBOARD_ALIGNMENT.md`, `EXTENSION_QA.md`, `RELEASE.md`, and `GUIDE.md`. Updated links in README, AGENTS, Cursor/Clinerules, and skills.
- Migrated `.seed` files from the plaintext JSON envelope (`version: "2.0.0"`) to the **`@seedcoat/wasm` v0.2.0 encrypted container** (hard cutover). Legacy plaintext/older `.seed` files are no longer supported and are rejected with `LEGACY_FORMAT_REJECTED`.
- Replaced the single `type: background` card with a **discriminated union (`location` / `temporal` / `social`)**, adding shared fields (`characterIds`, `tags`) and `locationKind` (location only). The previous `concept` / `country` / `category` fields were removed.
- Split project metadata `settings` into `editor` (`scenePrefixDigits`, `trackDraft?`) and a work-level `setting` (genre/country/concept/tags/description).
- Removed root `SEED-FORMAT.md`; the container spec is owned by [seedcoat](https://github.com/webfic/seedcoat). Storyboard policy lives in [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md).

### Added

- Passphrase prompts for Seed import/export (one prompt on import; entry + confirmation plus a loss warning on export). Empty passphrases are rejected and never stored.
- `inspectHeader` preflight on import to reject legacy plaintext `.seed` files before asking for a passphrase.
- Korean message mapping for all seedcoat error codes (`src/constants/projectStorageMessages.ts`).
- Progress notifications during `.seed` encode/decode (KDF wait).
- Pre-export validation for `scenePrefixDigits` and scene stems (`src/files/seedExportPreflight.ts`).
- Manual `.seed` QA in [`EXTENSION_QA.md`](EXTENSION_QA.md) and VSIX `.seed` smoke steps in [`RELEASE.md`](RELEASE.md).

### Notes

- Character `arc` / `recentDialogues` / `profile` / `attributes` are not preserved across a `.seed` round-trip (seedcoat discards them on encode). `trackDraft` is omitted from the seed `project` envelope and may be lost on sync overwrite. Existing workspace background cards in the old format are not auto-migrated.

## [0.1.3] - 2026-05-21

### Added

- Official specification document for the Seed `.seed` file format v2 envelope (`SEED-FORMAT.md`).
- Commands for creating a Storyboard project from a Seed file and syncing an existing project from a Seed file.
- Export command and related documentation for writing a Storyboard project to a Seed file.

## [0.1.2] - 2026-05-11

### Documentation

- Removed Visual Studio Marketplace publishing guidance from `README.md` and `doc/`, aligning distribution docs with GitHub Releases-only VSIX delivery.
- Added Korean changelog links and release-note sync guidance to `README.md` and `doc/plan.md`.

## [0.1.1] - 2026-05-09

### Added

- AI streaming RPC (`ai.generateStream`) and chunk event (`ai.generateStream.chunk`) for incremental UI updates; providers without native streaming fall back to one-shot generation via the registry.
- Setting `storyboard.ai.contextCondenseEnabled` to optionally trim long `previousContext` during scene draft generation.

### Changed

- Prompt variant selection now considers task, model, and token budget (`xs` / `generic` / `rich`) instead of provider-only routing.
- Long-form prompts (notably persona dialogue and genre formatting) gain richer instructions when the `rich` variant is selected.

## [0.1.0] - 2026-05-09

### Changed

- Documentation: aligned `doc/plan.md`, `doc/concept.md`, `doc/decisions/01-project-initialization.md`, `doc/testing/extension-qa.md`, and `README.md` with release policy — no `.picktion` import; extension UI i18n **`ko` default**, **`en` optional**; first Marketplace target **0.1.0** (Phase 7–8).
- Documentation: `doc/plan.md` — Phase 7 now owns LICENSE, privacy, and Marketplace metadata **before** publish; Phase 8 is the final QA gate **immediately before** `vsce publish` (not after release).

### Added

- GitHub Release workflow for tag-based VSIX packaging with checksum assets.
- Local `npm run package:vsix` script backed by `@vscode/vsce`.
- Settings webview panel (`Storyboard: Open Settings`) for default provider, curated model picks per provider, per-task provider overrides, Ollama base URL, API keys (SecretStorage), and connection checks; settings RPCs and `settings.changed` sync with host configuration and secrets.
- Scene-to-draft generation pipeline with cache metadata and optional trait updates on new drafts (Phase 4).
- Scenes sidebar webview with tree, status badges, and in-view actions (Phase 5).
- Character relation graph panel (d3-force) and `Storyboard: Open Character Relation Graph` command (Phase 5).
- CodeLens on `scene/*.txt` for generate/regenerate draft and apply format when a draft exists (Phase 5).
- CodeLens on `draft/*.md` for re-generate, grammar check, and expand (grammar/expand show Phase 6 placeholder notices) (Phase 5).
- Manual MVP QA guide at `doc/testing/extension-qa.md` for 0.0.1 dogfooding (Phase 5).
- Established the repository baseline for the Storyboard VSCode extension.
- Added the initial TypeScript and esbuild extension-host scaffold.
- Added the `storyboard.helloWorld` sanity-check command.
- Added VSCode launch/tasks configuration for F5 extension debugging.
- Added ESLint and Prettier baseline configuration.
- Added the `storyboard.init` command for creating a Storyboard workspace structure.
- Added project metadata validation for `.storyboard/project.json`.
- Added extension-host workspace, path convention, and logger modules.
- Added the Storyboard Activity Bar container and sidebar placeholder view.
- Added a minimal Vite and React webview UI build.
- Added `.card` YAML schemas, round-trip tests, and a Storyboard card custom editor.
- Added Characters and Backgrounds sidebar views with file watching and card opening.
- Added commands for creating character and background cards from the sidebar.
- Added Storyboard AI provider configuration keys with `mock` as the default provider.
- Added SecretStorage-backed API key management and the `Storyboard: Set API Key...` command.
- Added testable `SecretStore` and `ConfigBridge` adapters for Phase 3 AI integration.
- Added the Phase 3 AI provider registry with mock and OpenAI provider support.
- Added initial `ai.providers.list`, `ai.providers.checkConnection`, and `ai.generate` RPC contracts.
- Added Claude, Google Gemini, and Ollama provider support in the Phase 3 AI registry.
- Added deterministic AI utility modules for response parsing, JSON repair, and trait processing.
- Added a minimal Storyboard AI service facade and core prompt modules for Phase 3 orchestration.

### Documentation

- README aligned with Phase 5 scope and 0.0.1 dogfooding (no Marketplace publish yet).
- `doc/plan.md` MVP gate reframed for local `vsce package`, QA, and dogfooding.

### Changed

- Project license from MIT to Apache License 2.0 (`LICENSE`, `package.json`).

- Slimmed Phase 0 to focus on repository readiness instead of Picktion compatibility fixtures.
- Updated packaging scripts so `npm run build` bundles both the extension host and webview UI.
