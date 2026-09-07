# Storyboard Extension Overview

`storyboard` is a VSCode extension intended to become a one-click long-form novel generation IDE: it should plan, draft, review, revise, and assemble a full manuscript from project-level creative constraints.

The current implementation is still smaller than that target. Treat `scene/*.card → draft/*.md`, cards, canon, and draft diagnostics as the first working slice of a larger autonomous fiction pipeline rather than the final product boundary.

The repository is an npm-workspaces monorepo (`workspaces: ["apps/*", "packages/*"]`) with a single root `package-lock.json` and **one version for the whole repo**, held in the root manifest and mirrored into the apps by `npm run version:sync`.

The three apps share `packages/story-engine` and know nothing about each other. Only the host adapters differ: file system, workspace locator, logger, secrets, configuration, usage sink.

## Monorepo Layout

| Workspace | Name | Role |
|---|---|---|
| `apps/vscode` | `storyboard-vscode` | The VSCode extension. Holds the released version and the only `v*` tag. |
| `apps/bot` | `@storyboard/bot` | Telegram front end (`storyboard-bot`). Edits the **same** git workspace — no clone, no separate store. |
| `apps/cli` | `@storyboard/cli` | Command line app (`storyboard`). The headline product and reference implementation; other AI agents drive Storyboard through it. |
| `packages/story-engine` | `@storyboard/story-engine` | Runtime-agnostic core: domain policies, file records, and the RPC/contract types every app speaks. Holds what used to be `apps/vscode/src/{domain,shared}`. |
| `packages/story-format` | `@storyboard/story-format` | Workspace file format: schemas, codecs, path conventions, pure narrative helpers, and the shared round-trip fixtures. |
| `packages/story-ai` | `@storyboard/story-ai` | AI engine: provider registry, prompt catalog, response contracts, and the `SecretStore`/`ConfigBridge` ports. |
| `packages/story-git` | `@storyboard/story-git` | Commit/sync layer: `GitClient`, `SyncService`, push scheduling, and workspace git onboarding. |
| `packages/story-config` | `@storyboard/story-config` | The shared home `~/.storyboard`: `config.json` layers (home ← workspace `.storyboard/config.json`), the 0600 `secrets.json`, and file watchers. Every app reads settings through it. |

Packages expose TypeScript **source** (no build step); each app resolves them through its own
tsconfig `paths`, esbuild `alias`, and vitest `alias` — three places, all of which must agree.
`apps/vscode/scripts/check-architecture.mjs` enforces that no package imports `vscode` or an app
module.

All three apps write through the same codecs, so a card edited in Telegram, in the editor, or from
the terminal serializes to identical bytes — the shared fixtures in
`packages/story-format/test/fixtures/` are the round-trip guard for that claim.

## Current Architecture

```mermaid
graph TB
    subgraph Engine[packages/story-engine]
        Application[application: use cases and the novel pipeline]
        Persistence[persistence: repositories over IFileSystem]
        Domain[domain: policies, file records]
        SharedContracts[shared: RPC and card contracts]
        Ports[ports: IFileSystem, IWorkspaceLocator, IUsageSink, IStoryboardLogger]
    end

    subgraph Apps[Host apps]
        VscodeApp[apps/vscode: presentation, webview, VSCode adapters]
        CliApp[apps/cli: verbs, Node adapters]
        BotApp[apps/bot: telegram handlers, ContentService adapters]
    end

    VscodeApp --> Application
    CliApp --> Application
    BotApp --> Application
    VscodeApp -.implements.-> Ports
    CliApp -.implements.-> Ports
    BotApp -.implements.-> Ports
    Application --> Persistence
    Application --> Domain
    Persistence --> Ports
    Domain --> SharedContracts
```

What each check actually enforces, so a green run is not read as more than it is:

- `apps/vscode/scripts/check-architecture.mjs` — the extension entry may import only `vscode` and
  `./bootstrap/*`; `infrastructure` may not import `presentation` or `bootstrap`; no import cycles;
  and every shared package stays free of `vscode` and of app imports. The inner layers left for the
  engine, so nothing here validates them any more.
- `packages/story-engine`'s `shared` may import only itself (checked from the extension script).
- `apps/bot` and `apps/cli` each enforce their own ordered layer direction and reject cycles; the
  CLI additionally fails if it imports `@storyboard/story-pipeline` directly, which would be a
  second copy of the generation loop.

- `packages/story-engine` — its own layer direction: `shared` may import only itself, `domain` only
  `domain`/`shared`, `paths` and `ai` only what is inward of them, `ports` only `ports`/`paths`/
  `domain`; plus no cycles. `persistence` and `application` are a mutually dependent pair by design
  (application declares the repository ports, persistence implements them), so no order is imposed
  between those two.

## Narration and Composition

시점은 `setting.pov`(5값: `first`, `first-retrospective`, `second`, `third-limited`,
`third-omniscient`) 하나로 시작하고, 이름 붙인 서술자가 필요해지면 `narrator/*.card`를 만든다.
카드는 인칭·지식 경계(`witnessed`/`omniscient`/`retrospective`)·시제·초점 인물·목소리를 갖는다.
해석은 **씬 카드 > `chapters.yaml`의 장 > 프로젝트 기본** 순이며, 아무것도 없으면 프롬프트에
시점 지시가 나가지 않는다(기존 작품의 결과가 달라지지 않게 하려는 의도).

구성(`setting.composition`)은 `linear` / `omnibus` / `alternating-pov` / `frame` 네 프리셋이고,
프리셋이 연속성 줄기(`setting.threads`)와 서술자 카드를 만든다. 줄기는 이야기 상태 원장·장
요약·직전 씬 맥락·페르소나/배경 기억의 스코프다 — 기본 줄기 `main`은 종전 경로를 쓰고 나머지는
`.storyboard/memory/threads/<id>/` 아래로 내려가며, **캐넌만 전역으로 공유**된다. 씬 번호는
전역으로 유지되고 원고 조립도 번호순이다.

지식 경계는 이야기 상태 원장의 항목마다 기록된 목격자(`- [12|hana,jun] …`)로 강제된다.
`witnessed` 서술자의 초점 인물이 목격자에 없으면 그 항목은 프롬프트에서 빠지고, 목격자가 없는
구 버전 항목은 판정할 수 없으므로 통과시킨다.

## Domain Boundaries

- **Extension host**: VSCode activation, commands, panels/views, persistence, file system access, external API access.
- **Webview UI**: Rendering, user interactions, local UI state.
- **Shared types**: Message contracts, settings/state interfaces, domain DTOs.

## State Strategy

- Settings live in `~/.storyboard/config.json` (all workspaces) and `<workspace>/.storyboard/config.json` (one workspace), read and written through `ConfigBridge` over `@storyboard/story-config`; the extension contributes no VSCode `configuration`.
- Credentials live in `~/.storyboard/secrets.json` (0600) through `SecretStore`, shared with the CLI and the bot.
- Use `context.workspaceState` only for transient editor state that no other app needs.
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

- `ARCHITECTURE.md` (repo root) for product concept, workspace layout, and file formats.
- `RELEASE.md` (repo root) for version commits, tags, and GitHub Releases.
- `apps/vscode/EXTENSION_QA.md` for manual extension QA.
- `apps/vscode/GUIDE.md` for draft editor features.
- Optional local-only `.doc/` (gitignored) for migration plans and ADRs.
