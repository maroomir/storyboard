# Architecture and Pattern Rules

Keep runtime boundaries explicit and introduce object-oriented patterns only when current complexity justifies them.

## Runtime Boundaries

- Keep extension activation and contribution wiring focused on lifecycle concerns.
- Keep VSCode APIs, file system access, terminals, subprocesses, and external integrations behind extension-host services or adapters when that improves testability.
- Keep shared domain code runtime-agnostic: no `vscode` imports and no browser-only APIs.
- Keep webview rendering and transient UI state separate from persisted extension-host state.
- Long-running work belongs in the extension host and must report progress without blocking activation or message handling.

## Pattern Adoption

- Use Strategy or Factory when multiple implementations already vary behind one contract.
- Use Command-style handlers when contributed commands need independent validation, execution, and tests.
- Use a Facade or controller only when orchestration spans multiple services and the simpler direct flow is no longer readable.
- Keep external APIs and runtime-specific details behind adapters when domain code would otherwise depend on them.
- Do not create interfaces, classes, or layers for simple single-use behavior.
- Prefer plain functions and focused modules until substitution, lifecycle, or state ownership requires an object.

## Pipelines Are Data

- Both generation loops are stage lists: the scene pipeline (`packages/story-pipeline`,
  `ISceneStage` over a shared run state) and the novel pipeline (`packages/story-engine`,
  `INovelStage` over the run context). A runner walks the plan in force and calls each stage.
- The plan is the stage catalog's order until an author's `pipelines/{scene,novel}.yaml` is laid
  over it (`@storyboard/story-format`'s `pipelineSpec`); the catalog (`id`, `label`, `required`,
  `requires`) is what the file is validated against. New behaviour in a loop is a new stage with
  a catalog row, not a branch inside an existing one.
- Stage ids are contract: the novel ids are `novelStageNames` (every host's stage rail), the scene
  progress ids are what the hosts label. Rename one and every host changes.

## Structural Source of Truth

Existing code and tests define the actual directory layout. Architecture documents describe boundaries and intent; do not maintain speculative file trees after implementation diverges.
