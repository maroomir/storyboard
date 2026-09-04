---
name: card-scene-format
description: >-
  Storyboard workspace layout, .card YAML rules, scene/draft/cache file naming,
  and custom editor expectations. Use when editing character/background cards,
  scene seeds, project init, path helpers, or docs about file formats.
---

# Card and scene formats (Storyboard)

Primary references: [`ARCHITECTURE.md`](ARCHITECTURE.md). Code: [`packages/story-format/src/files/card.ts`](packages/story-format/src/card.ts), [`packages/story-format/src/scene.ts`](packages/story-format/src/scene.ts). Extended ADR (local): `.doc/decisions/02-card-files-and-editor.md`.

## Workspace model

- One VSCode workspace folder = one novel project.
- Tracked content: `character/`, `background/`, `scene/`, `.storyboard/project.json` (and optional `.storyboard/settings.json`).
- Regeneratable: `draft/`, `.storyboard/cache/`—default gitignore targets; do not treat as durable user source.
- Durable AI memory: `.storyboard/memory/` (story state, persona/background memory, dialogue sidecars, chapter summaries) is tracked—no committed input reproduces it.

## `.card` (YAML)

- On disk: YAML; UI: custom text editor for `*.card`.
- **Card `id`**: `^[a-z0-9][a-z0-9-]*$` only (ASCII). Human-readable names go in `name`. Keeps filenames and refs portable—see `cardIdPattern` / `cardSchema` in [`packages/story-format/src/files/card.ts`](packages/story-format/src/card.ts).
- **Source of truth for edits**: `TextDocument`; webview/form changes serialize to YAML and replace document text (full replace is acceptable until diff sync is needed).
- **Codec**: keep `parseCard` / `serializeCard` in [`packages/story-format/src/files/card.ts`](packages/story-format/src/files/card.ts) testable with round-trip tests.
- **List-form text fields**: character `voice`/`description`/`desire` and background `description`/`senses` are `string[]` (one bullet per item), not prose. Background `time`/`weather` are scalar strings. Edit them via the `편집` tab's list inputs; they serialize to YAML sequences. Use `joinCardText` (in `packages/story-format/src/files/card.ts`) wherever a field is fed to prompts/hashes. Legacy prose cards are converted by the `storyboard.cards.migrateTextToList` command (`packages/story-engine/src/domain/cardTextMigration.ts`).

## Scenes (`scene/*.card`)

- Filename: `NN-<slug>.card` where `NN` is zero-padded order and `<slug>` is lowercase letters, digits, hyphens—see `sceneFileNamePattern` in [`packages/story-format/src/scene.ts`](packages/story-format/src/scene.ts). The card's `id` must equal that stem.
- YAML with `type: scene`. Metadata (`title`/`characters`/`location`/`mood`/`relationStage`/`targetWordCount`/`grounding`), structured seed fields (`purpose`/`conflict`/`twist`/`emotionalShift`/`foreshadowing`/`neededCanon`), and a free-prose `summary`.
- **Codec**: `parseScene`/`parseSceneCard`/`serializeSceneCard` in [`packages/story-format/src/files/scene.ts`](packages/story-format/src/files/scene.ts). Serialization is canonical like entity cards, so `canonicalizeSceneCardText` exists for deliberate normalization.
- **Prompt contract**: `SceneFile.body` is rendered from the card (`renderSceneCardBody`) as the same `[목적]`/`[갈등]` labeled blocks the old seed format used—prompts did not change with the format.
- **Legacy `.txt`**: no longer read. Convert with `storyboard.scene.migrate` (Desktop) or `/doctor migrate` (bot); both call `convertLegacySceneText` in [`packages/story-format/src/files/sceneMigration.ts`](packages/story-format/src/files/sceneMigration.ts), which is deterministic—labeled blocks become fields, free prose becomes `summary`.
- **Editor**: scene cards open in the same `storyboard.card` custom editor; the scene form adds an AI **Summary에서 구조화** action (`cards.structureScene`) that proposes only the empty structure fields for review.
- **Background attachment**: a scene attaches a background via frontmatter `location: <id>`, or—when absent—by auto-detecting a background whose `name`/`aliases` appear in the body (most-specific/longest match wins). Mirrors character name/alias detection; see `resolveSceneBackground`/`detectSceneBackground` in [`packages/story-format/src/sceneContext.ts`](packages/story-format/src/sceneContext.ts). Backgrounds support an optional `aliases: string[]` for body surface forms.

## Drafts and cache

- `draft/<scene>.md`: AI-generated prose; may be overwritten on regenerate.
- `.draft/<scene>/<yyyy-mm-dd-hh-mm>-rev-NN.md`: previous-draft history archived before an overwrite when `storyboard.draft.keepHistory` is on (off by default). Local archive time + per-scene incrementing revision; gitignored like `draft/`. See `archiveExistingDraft` in [`packages/story-engine/src/domain/files/draftHistory.ts`](packages/story-engine/src/domain/files/draftHistory.ts), wired in [`apps/vscode/src/presentation/commands/generateDraft.ts`](apps/vscode/src/presentation/commands/generateDraft.ts).
- `.storyboard/cache/scenes/<scene>.json`: extension-managed context snapshots; users should not hand-edit paths outside the tool.

## When changing formats

- Update zod schemas, file helpers, and **fixtures** under `packages/story-format/test/fixtures/` together.
- Run: `npm run test` and any card/scene-specific specs you touched.
