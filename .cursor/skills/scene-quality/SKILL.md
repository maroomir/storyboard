---
name: scene-quality
description: >-
  Iteratively test and improve a Storyboard workspace scene's generated draft
  toward ground-truth (gt) quality on four narrative axes (서사력·연결성·장면구분·전환).
  Runs the headless generate -> coverage -> evaluate-vs-gt -> diagnose -> fix+test
  -> regenerate loop with a PM + evaluator + tester agent team. Use when asked to
  improve scene generation quality, score a draft against gt, or harden the
  generation pipeline against a quality regression.
---

# Scene generation quality loop (storyboard)

> Mirror of the Claude Code skill `.claude/skills/scene-quality/SKILL.md` — keep the two in sync.

Pushes one workspace scene's generated draft toward its human-written gt. The pipeline (extraction → persona → dialogue → chunked format) lives in `apps/desktop/src/infrastructure/ai/`; this skill drives it headlessly, measures quality objectively + qualitatively, and tunes code/data until the four axes pass.

All harness and test commands below run from `apps/desktop` (the harness include glob resolves against the current working directory; running it from the repo root collects zero tests).

## Inputs

- workspace path (a Storyboard project dir with `scene/`, `gt/`, `character/`, `background/`, `.storyboard/project.json`)
- scene file name `NN-slug.txt`; its gt is `gt/NN-slug.md`

## Invariants (non-negotiable)

- **Source `scene/*.txt` is IMMUTABLE.** Never edit or augment it. Quality must come from the pipeline (`apps/desktop/src/`) + the workspace cards.
- **gt is the evaluation ORACLE only.** It may inform character/background cards, but must NEVER be injected into generation prompts.
- **Provider:** codex (gpt-5.5) default; the harness auto-falls-back to claude-code (sonnet-4.6) on a codex usage-limit mid-run. Force with `SCENE_PROVIDER=claude-code`.
- **Every `apps/desktop/src/` change is tested** by the test-engineer; **commit per validated feature, never batch**. Branch first if on `main`.
- A full regeneration is ~30–50 CLI calls / ~40–90 min. Plan iterations; don't poll — background tasks notify on completion.

## Team

- **PM (you):** orchestrate the loop, pick the single highest-leverage gap each cycle, decide gates.
- **Evaluator (`scenario-analyst`):** score the draft vs gt using `./rubric.md`. Read-only — never generates or edits a draft.
- **Tester (`test-engineer`):** write/maintain unit tests for each `apps/desktop/src/` change (`cd apps/desktop && npx vitest run`).
- Optional: a general/`debugger` helper for `apps/desktop/src/` edits, a general helper to fill workspace cards.

## Loop

1. **Generate** (writes `draft/NN-slug.md`):
   `cd apps/desktop && SCENE_WS=<ws> SCENE_FILE=<NN-slug.txt> npx vitest run --config vitest.harness.config.ts generateGuerrila`
   Back up each iteration to `<ws>/draft-history/` before regenerating.
2. **Objective coverage:**
   `cd apps/desktop && SCENE_WS=<ws> SCENE_FILE=<NN-slug.txt> npx vitest run --config vitest.harness.config.ts coverageCheck`
   Read `coveredRatio` + `missing` / `outOfOrder` beat indices (the `checkSceneCoverage` feature).
3. **Qualitative eval:** hand the draft + gt + source to `scenario-analyst`; it scores with `./rubric.md` (gate A, 4 axes, 6-dim /30).
4. **Diagnose** the single highest-leverage gap (gate-A failures first: truncation/order).
5. **Fix** in `apps/desktop/src/` (pipeline/prompts) and/or workspace cards. Tester adds tests for any `apps/desktop/src/` change. For cards, only `voice`/`aliases`/`traits`/`description` (+`name`/`role`) actually affect generation — see `apps/desktop/docs/card-parameter-impact.md`.
6. **Regenerate → re-score.** Loop until all four axes ≥4 and coveredRatio → 1.0. Then commit per feature.

Useful knobs: `SCENE_PROVIDER=claude-code` (force claude), `SCENE_REVISE=0` (skip the post-gen revise loop), `SCENE_MODEL=<id>`. Legacy `GUERRILA_*` env names still work as a fallback.

## Known levers & pitfalls (from prior runs)

- **Format truncation/meta-leak:** the final format step must run in CHUNKS (`chunkDialoguePiecesByBudget`) or a long scene's tail is dropped (coveredRatio collapses) or an LLM meta-message ("분량 한계라 연재형/압축형 중 고르라") leaks into the manuscript at a chunk boundary; `looksLikeFormatMetaLeak` guards the leak.
- **Over-segmentation:** situation extraction must be granularity-controlled ("장면 단위로 묶되 빠짐없이"), else it splits to 50+ beats and blows up time + length.
- **Premature character entry:** forbid staging not-yet-arrived characters, or an anticipated character appears too early (out-of-order first meeting).
- **Card reality:** only ~6 card fields reach generation; background only when the scene has `frontmatter.location`. See `apps/desktop/docs/card-parameter-impact.md`.

## References

- Rubric: `./rubric.md` (mirror of `apps/desktop/docs/scene-quality-rubric.md`)
- Harness + coverage probe: `apps/desktop/scripts/harness/generateGuerrila.harness.ts`, `apps/desktop/scripts/harness/coverageCheck.harness.ts`, `apps/desktop/vitest.harness.config.ts`
- Coverage feature: `AIService.checkSceneCoverage`, `apps/desktop/src/shared/sceneCoverage.ts`, task `sceneCoverage`
- Parameter impact: `apps/desktop/docs/card-parameter-impact.md`
- Pipeline: `apps/desktop/src/application/pipelines/sceneGenerationPipeline.ts`, `apps/desktop/src/infrastructure/ai/prompts/`
