# Changelog

All notable changes to Storyboard will be documented in this file.

Korean changelog: [CHANGELOG.md](CHANGELOG.md).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first public release.

## [Unreleased]

### Changed

- Migrated `.seed` files from the plaintext JSON envelope (`version: "2.0.0"`) to the **`@seedcoat/wasm` v0.2.0 encrypted container** (hard cutover). Legacy plaintext/older `.seed` files are no longer supported and are rejected with `LEGACY_FORMAT_REJECTED`.
- Replaced the single `type: background` card with a **discriminated union (`location` / `temporal` / `social`)**, adding shared fields (`characterIds`, `tags`) and `locationKind` (location only). The previous `concept` / `country` / `category` fields were removed.
- Split project metadata `settings` into `editor` (`scenePrefixDigits`, `trackDraft?`) and a work-level `setting` (genre/country/concept/tags/description).
- Removed root `SEED-FORMAT.md`; the container spec is owned by [seedcoat](https://github.com/maroomir/seedcoat). Storyboard policy lives in [`doc/migration/storyboard-alignment.md`](doc/migration/storyboard-alignment.md).

### Added

- Passphrase prompts for Seed import/export (one prompt on import; entry + confirmation plus a loss warning on export). Empty passphrases are rejected and never stored.
- `inspectHeader` preflight on import to reject legacy plaintext `.seed` files before asking for a passphrase.
- Korean message mapping for all seedcoat error codes (`src/constants/projectStorageMessages.ts`).

### Notes

- Character `arc` / `recentDialogues` / `profile` / `attributes` are not preserved across a `.seed` round-trip (seedcoat discards them on encode). Existing workspace background cards in the old format are not auto-migrated.

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
