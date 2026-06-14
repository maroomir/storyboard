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

## Structural Source of Truth

Existing code and tests define the actual directory layout. Architecture documents describe boundaries and intent; do not maintain speculative file trees after implementation diverges.
