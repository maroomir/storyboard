---
name: card-scene-format
description: >-
  Storyboard workspace layout, element bundles (card.yaml header + statements.yaml),
  scene/draft/cache file naming, and the read-only card viewer. Use when editing
  character/background/narrator/scene bundles, project init, path helpers, or docs
  about file formats.
---

# Card and scene formats (Storyboard)

Primary references: [`ARCHITECTURE.md`](ARCHITECTURE.md). Vocabulary: [`packages/story-model/src/element/`](packages/story-model/src/element/) (one file per kind, the facet catalog and the statement schema). Paths and codecs: [`packages/story-model/src/format/bundlePaths.ts`](packages/story-model/src/format/bundlePaths.ts), [`bundleFiles.ts`](packages/story-model/src/format/bundleFiles.ts), [`structure.ts`](packages/story-model/src/format/structure.ts).

## Workspace model

- One workspace folder = one novel. `.storyboard/project.json` is the contract (`version` `2.0.0`; a `1.0.0` work is refused as «0.15 형식», with no conversion).
- `.storyboard/structure.yaml`: `threads: [{id, title}]` and `scenes: [{scene: <uuid>, thread, narrator?, storyTime?}]`. Scene order, and so every scene number, comes from here.
- Tracked content: the bundles under `character/`, `background/`, `narrator/`, `scene/`, plus `draft/`, `.storyboard/project.json`, `structure.yaml` and `.storyboard/outline/`.
- Agent guide: `AGENTS.md` plus a one-line `CLAUDE.md` (`@AGENTS.md`), written by init only when missing (`init --repair` fills gaps). The text lives in `packages/story-engine/src/persistence/workspaceAgentGuide.ts`; name commands as `storyboard <verb>` there, because `apps/cli/test/help.test.ts` checks each one against the command catalog.
- Git-ignored and rebuildable: `.storyboard/cache/` — one SQLite file `storyboard.db` (`sessions`, `runs`, `usage`, `element_index`, `lock`, `findings`, `journal`, `chapter_summaries`, `revision_plans`, plus `schema_version`; a mismatched version drops and rebuilds it), draft revisions under `cache/revisions/<scene uuid>/` (the last `keptDraftRevisionCount` = 10 per scene), scene context snapshots and review rounds under `cache/scenes/<scene uuid>/` (`generation.json`, `revise-rounds.json`), so renumbering moves nothing. Nothing a writer needs lives only there except pending proposals and chapter summaries, which are regenerated.

## Bundles (`<kind>/<slug>.card/`)

- Every element is a folder: `card.yaml` (the header: `id` uuid, `slug`, `kind`, a name or title and the few header fields of its kind) and `statements.yaml` (a top-level list, no envelope). Characters and backgrounds also hold `memory/<thread>.yaml` (`throughScene`, `cardHash`, `persona`, `voiceSample: [{text, source}]`) and one image (`profile.png` / `image.png`).
- **Identity**: the folder name is the slug (`^[a-z0-9][a-z0-9-]*$`); the uuid in `card.yaml` never changes. References between elements (`cast`, `place`, `about`, `knownBy`, a narrator's focal, `structure.yaml`) are uuids, so renaming a slug rewrites nothing else. Two folders with one uuid fail `doctor`; `init --repair` gives the later one a new uuid.
- **Statements** carry `facet`, `value`, optional `key`/`about`/`since`/`until`/`revealFrom`/`knownBy`/`keywords`, and `source.origin` (`author`, `agent`, `studio`, `interview`). An author line is never overwritten (`statementMerge.ts`). Generation writes memory and scene state only, never statements.
- **Who writes**: the engine through manager verbs (`card create|set|unset|edit|apply|remove`, the studio, the interview, notes absorb). A file changed outside the engine is read with a warning; a schema mismatch fails. Proposals wait in the card's session in the cache DB until `card apply` / `card discard`.
- **Viewer**: the extension opens `**/*.card/card.yaml` in a read-only viewer (header line + statements grouped by the facet's section); «텍스트로 열기» opens the YAML, «스튜디오에서 고치기» edits through the studio.

## Scenes (`scene/NNN-slug.card/`)

- Folder `NNN-slug.card` where `NNN` is the three-digit number derived from `structure.yaml` and the slug has no number (`formatNumberedSceneStem` / `parseNumberedSceneStem`). The engine renames folders and drafts when scenes are inserted, moved or removed (`scene create --after`, `scene move`, `scene remove`), through the cache DB `journal`. The CLI accepts `NNN-slug`, the number, or the slug.
- Files: `card.yaml` (`title`, `cast`, `place`, `time`, `targetWordCount` only when it differs from the project), `statements.yaml` (design: `purpose`, `conflict`, `emotionalShift`, `twist`, `foreshadowing` …), `beats.yaml` (a list of `{text, cast?, place?, time?}`, cast and place as uuids), `summary.md`, and what generation writes: `dialogue.json` and `state.yaml`.
- `state.yaml` is the story-state ledger of that scene: `inputHash` (the scene input the draft was made from) and its statements (`event`, `relationShift`, `reveal`, `motif`, each with `knownBy`). A thread's ledger is its scenes' `state.yaml` in structure order. A draft is current when its `inputHash` matches the input recomputed now, cache or no cache.
- **Grounding** (incident, place, time) is derived, never stored: the title and first beat, the first beat's place or the place card's name, the first beat's time (`sceneGroundingDerivation.ts`).
- **Beats**: `draft generate` expands empty beats before drafting and writes them to `beats.yaml` (`generation.beats.auto`/`charsPerBeat`/`minBeats`); `scene plot` runs the same use case up front and overwrites only with `--force`.
- **Prompt contract**: prompts still read the old card shapes: `domain/cardProjection.ts` and `domain/sceneProjection.ts` project a bundle into `CharacterCard`/`BackgroundCard`/`SceneCard`, and `renderSceneCardBody` renders the `[목적]`/`[갈등]` blocks.

## Drafts

- `draft/NNN-slug.md`: AI-generated prose outside the bundle; overwritten on regenerate after the previous one is kept in `cache/revisions/<scene uuid>/`.

## When changing formats

- Update the element vocabulary, the zod schemas, the codecs and the round-trip **fixtures** under `packages/story-model/test/fixtures/` (`bundles/magicboy/`) together.
- An intended change to what a work writes is a golden snapshot update (`npm run bvt:golden -- --update`) in the same commit.
- Run `npm test` and the bundle specs you touched.
