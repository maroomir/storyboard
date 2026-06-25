---
name: card-scene-format
description: >-
  Storyboard workspace layout, .card YAML rules, scene/draft/cache file naming,
  and custom editor expectations. Use when editing character/background cards,
  scene seeds, project init, path helpers, or docs about file formats.
---

# Card and scene formats (Storyboard)

Primary references: [`ARCHITECTURE.md`](ARCHITECTURE.md). Code: [`src/shared/card.ts`](src/shared/card.ts), [`src/shared/scene.ts`](src/shared/scene.ts). Extended ADR (local): `.doc/decisions/02-card-files-and-editor.md`.

## Workspace model

- One VSCode workspace folder = one novel project.
- Tracked content: `character/`, `background/`, `scene/`, `.storyboard/project.json` (and optional `.storyboard/settings.json`).
- Regeneratable: `draft/`, `.storyboard/cache/`—default gitignore targets; do not treat as durable user source.

## `.card` (YAML)

- On disk: YAML; UI: custom text editor for `*.card`.
- **Card `id`**: `^[a-z0-9][a-z0-9-]*$` only (ASCII). Human-readable names go in `name`. Keeps filenames and refs portable—see `cardIdPattern` / `cardSchema` in [`src/shared/card.ts`](src/shared/card.ts).
- **Source of truth for edits**: `TextDocument`; webview/form changes serialize to YAML and replace document text (full replace is acceptable until diff sync is needed).
- **Codec**: keep `parseCard` / `serializeCard` in [`src/files/card.ts`](src/files/card.ts) testable with round-trip tests.
- **List-form text fields**: character `voice`/`description`/`desire` and background `description`/`senses` are `string[]` (one bullet per item), not prose. Background `time`/`weather` are scalar strings. Edit them via the `편집` tab's list inputs; they serialize to YAML sequences. Use `joinCardText` (in `src/shared/card.ts`) wherever a field is fed to prompts/hashes. Legacy prose cards are converted by the `storyboard.cards.migrateTextToList` command (`src/core/cardTextMigration.ts`).

## Scenes (`scene/*.txt`)

- Filename: `NN-<slug>.txt` where `NN` is zero-padded order and `<slug>` is lowercase letters, digits, hyphens—see `sceneFileNamePattern` in [`src/shared/scene.ts`](src/shared/scene.ts).
- Optional YAML frontmatter for title, characters, location, mood; body is the scene seed text.
- **Background attachment**: a scene attaches a background via frontmatter `location: <id>`, or—when absent—by auto-detecting a background whose `name`/`aliases` appear in the body (most-specific/longest match wins). Mirrors character name/alias detection; see `resolveSceneBackground`/`detectSceneBackground` in [`src/core/sceneContext.ts`](src/core/sceneContext.ts). Backgrounds support an optional `aliases: string[]` for body surface forms.

## Drafts and cache

- `draft/<scene>.md`: AI-generated prose; may be overwritten on regenerate.
- `.storyboard/cache/scenes/<scene>.json`: extension-managed context snapshots; users should not hand-edit paths outside the tool.

## When changing formats

- Update zod schemas, file helpers, and **fixtures** under `test/fixtures/` together.
- Run: `npm run test` and any card/scene-specific specs you touched.
