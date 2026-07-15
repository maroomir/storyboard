# Storyboard Extension Overview

`storyboard` is a VSCode extension intended to become a one-click long-form novel generation IDE: it should plan, draft, review, revise, and assemble a full manuscript from project-level creative constraints.

The current implementation is still smaller than that target. Treat `scene/*.txt → draft/*.md`, cards, canon, and draft diagnostics as the first working slice of a larger autonomous fiction pipeline rather than the final product boundary.

## Current Extension-Host Architecture

```mermaid
graph TB
    subgraph VSCode[VSCode Extension Host]
        ExtensionEntry[src/extension.ts]
        Bootstrap[src/bootstrap/StoryboardApplication]
        Presentation[src/presentation commands, providers, messaging]
        Application[src/application use cases and pipelines]
        Infrastructure[src/infrastructure adapters]
        Domain[src/domain policies and codecs]
        Shared[src/shared contracts]
        State[VSCode globalState/workspaceState/secrets]
    end

    subgraph Webview[Webview UI]
        App[webview-ui]
        MessageClient[Typed message client]
    end

    ExtensionEntry --> Bootstrap
    Bootstrap --> Presentation
    Bootstrap --> Infrastructure
    Presentation --> Application
    Infrastructure --> Application
    Application --> Domain
    Domain --> Shared
    Infrastructure --> State
    Presentation <--> MessageClient
    MessageClient --> App
```

The legacy `core`/`files`/`services`/`commands`/`providers`/`messaging`/`utils`/`constants` directories have been fully migrated into the target layers; `scripts/check-architecture.mjs` now enforces layer direction (no reverse imports, no cycles, no `vscode` import outside the allowed layers).

## Domain Boundaries

- **Extension host**: VSCode activation, commands, panels/views, persistence, file system access, external API access.
- **Webview UI**: Rendering, user interactions, local UI state.
- **Shared types**: Message contracts, settings/state interfaces, domain DTOs.

## State Strategy

- Use `context.globalState` for user settings that apply across workspaces.
- Use `context.workspaceState` for workspace-specific state.
- Use `context.secrets` for credentials and sensitive tokens.
- Avoid duplicating persistent state in the webview; treat extension host state as the source of truth.

## Communication Strategy

- Use typed message contracts for extension ↔ webview communication.
- Validate message shape at boundaries when messages carry user input or external data.
- Keep long-running work in the extension host and report progress to the webview.

## Reference to Cline

Cline demonstrates a mature VSCode extension architecture with extension-host orchestration, webview communication, persistent state, and task execution patterns. For `storyboard`, borrow the ideas that fit the immediate product scope and avoid unnecessary complexity until needed.

## Product Direction

- Prefer features that move Storyboard toward autonomous long-form generation: project contract, outline, scene seed factory, draft loop, review loop, and manuscript assembly.
- Keep every autonomous step inspectable as files or diagnostics so users can understand and rerun failed stages.
- Do not assume one giant prompt is the architecture for generating a novel. Break generation into typed, restartable stages.

## Tracked documentation

- `ARCHITECTURE.md` for product concept, workspace layout, and file formats.
- `STORYBOARD_ALIGNMENT.md` for `.seed` exchange policy with Seeds.
- `EXTENSION_QA.md` for manual extension QA.
- `RELEASE.md` for version commits, tags, and GitHub Releases.
- `GUIDE.md` for draft editor features.
- Optional local-only `.doc/` (gitignored) for migration plans and ADRs.
