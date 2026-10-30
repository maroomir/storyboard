# Architecture and Pattern Rules

Keep runtime boundaries explicit. The code is class-centred: one `StoryboardApplication` owns the
object graph, a manager fronts each domain, and the work under them is done by objects that hold
their dependencies. Functions are for pure computation.

## Runtime Boundaries

- Keep extension activation and contribution wiring focused on lifecycle concerns.
- Keep VSCode APIs, file system access, terminals, subprocesses, and external integrations behind extension-host services or adapters when that improves testability.
- Keep shared domain code runtime-agnostic: no `vscode` imports and no browser-only APIs.
- Keep webview rendering and transient UI state separate from persisted extension-host state.
- Long-running work belongs in the extension host and must report progress without blocking activation or message handling.

## Objects and Functions

Every exported function falls into one of three buckets, and the bucket decides its shape.

- **Pure computation stays a function.** Input in, output out: no dependency (file system, AI,
  logger, repository) and no state between calls — string work, planning arithmetic, validators,
  codecs, path rules. Group these in a module named for the subject.
- **A hidden `this` becomes a class.** When several functions in one module take the same large
  first parameter (`run`, `container`, `deps`, `fetch`, a store), that parameter is the hidden
  `this`: the functions become one class that takes it in the constructor and exposes the verbs as
  public methods. The same holds for anything that keeps state between calls or is one of several
  variants behind an `I`-port. Dependencies arrive through the constructor as one `readonly` deps
  interface, steps are `private` methods, and a method handed out as a callback is an arrow field
  so `this` survives.
- **Values stay values.** Record shapes are `readonly` `interface`s, outcomes are discriminated
  unions, tables are `as const`. A `Builder` only when assembly takes several steps.

How to tell by eye: the same large first parameter three times in one file means a class;
parameters that are only strings, numbers and value types mean a function; a file of `interface`
and `type` alone is values.

Where the ecosystem asks for functions and values, keep them: React and Ink components, zod
schemas, `as const` catalogs, `*.params.json`, and tests (a vitest suite stays functions; a test
of a class builds an instance).

## Pattern Adoption

- Strategy and Factory where several implementations already vary behind one `I`-port; a registry
  with self-registration when adding a variant must not edit the factory
  (`registerProviderFactory` is the model).
- Command-style handlers for CLI verbs and contributed commands, so each has its own validation,
  execution and tests: one class per command in a file of its own, `ICommandHandler` in the CLI
  (the class carries its `spec`) and `IExtensionCommand` in the extension (the class carries its
  `id`), registered by one registrar per app rather than by a function per command.
- Facade: `StoryboardApplication` is the one composition root and a manager fronts each domain; a
  further facade only when orchestration spans several services and the direct flow is no longer
  readable.
- Apps speak to the engine only through manager verbs: an app never constructs an engine class, never
  reads a setting the engine decides with, and never strings together a flow another app also needs —
  that flow becomes one manager verb. `refuseEngineConstruction` in
  `scripts/architecture/runner.mjs` fails an app that `new`s an engine class; the only exception is a
  host-side piece its composition root hands in (the desktop's `UsageLedgerRecorder`).
- Adapters keep external APIs and runtime-specific details out of domain code.
- Abstraction follows variation: an `I`-port, a Strategy or a Factory needs at least two real
  implementations or a defined extension point. A single-use behaviour is a plain class (when it
  holds dependencies or state) or a function (when it does not), never an interface with one
  implementation.

## Pipelines Are Data

- Both generation loops are stage lists: the scene pipeline (`packages/story-engine/src/pipeline/scene`,
  one `ISceneStage` class per file under `stages/` over a `SceneGenerationRun`) and the novel pipeline (`packages/story-engine`,
  `INovelStage` over the run context). A runner walks the plan in force and calls each stage.
- The plan is the stage catalog's order until an author's `pipelines/{scene,novel}.yaml` is laid
  over it (`@storyboard/story-model`'s `pipelineSpec`); the catalog (`id`, `label`, `required`,
  `requires`) is what the file is validated against. New behaviour in a loop is a new stage with
  a catalog row, not a branch inside an existing one.
- Stage ids are contract: the novel ids are `novelStageNames` (every host's stage rail), the scene
  progress ids are what the hosts label. Rename one and every host changes.

## Structural Source of Truth

Existing code and tests define the actual directory layout. Architecture documents describe boundaries and intent; do not maintain speculative file trees after implementation diverges.
