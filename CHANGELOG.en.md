# Changelog

All notable changes to Storyboard will be documented in this file.

Korean changelog: [CHANGELOG.md](CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first public release.

## [Unreleased]

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
- Removed root `SEED-FORMAT.md`; the container spec is owned by [seedcoat](https://github.com/maroomir/seedcoat). Storyboard policy lives in [`STORYBOARD_ALIGNMENT.md`](STORYBOARD_ALIGNMENT.md).

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
