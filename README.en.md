# Storyboard

한국어: [`README.md`](README.md)

Storyboard writes a full-length novel as a chain of **small, verifiable steps**. It starts from a
project contract (genre, audience, point of view, length) and goes through character and background
cards, a synopsis and chapter plan, scene seeds, scene drafts, review and revision, and manuscript
assembly. Every step is a file in the work's repository, so any stage can be inspected, undone and
rerun. The core is not one giant prompt but scene-by-scene generation that is fed the previous
prose, the canon, and a story-state ledger.

Three apps share one engine. A work is a git repository, and the AI key is the writer's own
(`~/.storyboard/secrets.json`).

| App | For | Install |
|---|---|---|
| **CLI** `storyboard` | Terminal users and **AI agents that drive Storyboard**. The reference implementation | `curl -fsSL https://raw.githubusercontent.com/maroomir/storyboard/main/scripts/install.sh \| bash` |
| **VS Code extension** | Writers who want cards, scenes and drafts inside the editor | the `.vsix` on the [latest release](https://github.com/maroomir/storyboard/releases/latest) |
| **Desktop app** | Writers without developer tools: a manuscript desk, a run drawer, automatic version history | the `.dmg` / `-setup.exe` on the [latest release](https://github.com/maroomir/storyboard/releases/latest) |

## One cycle

```bash
storyboard init --title "Night Passage" --genre mystery --pov third-limited --target-words 300000
storyboard setup                      # provider and key (claude, openai, google, grok, ollama)
storyboard outline generate           # contract → synopsis and chapter plan
storyboard scene seeds                # chapter plan → scene/*.card
storyboard scene beats --all          # event beats for every scene
storyboard scene generate 01-prologue # skeleton → dialogue → section expansion → checks → review and revise
storyboard check continuity 01-prologue
storyboard manuscript assemble        # draft/*.md → manuscript
```

`storyboard novel generate` runs all of it without approvals. When the run budget
(`budget.run.limitUsd`) is reached it finishes the scene in progress and stops; running it again
continues. A new work also gets an `AGENTS.md`, so an agent such as Claude Code goes through these
commands instead of writing the prose itself.

## Repository layout

An npm-workspaces monorepo. Packages expose TypeScript source with no build step; the apps bundle them.

| Workspace | Name | Role |
| --- | --- | --- |
| [`apps/vscode`](apps/vscode/) | `storyboard-vscode` | The VS Code extension: a fiction-writing IDE |
| [`apps/cli`](apps/cli/) | `@storyboard/cli` | The CLI (`storyboard`): the headline product and reference implementation |
| [`apps/desktop`](apps/desktop/) | `@storyboard/desktop` | The desktop app for writers (Electron; macOS Apple Silicon and Windows) |
| [`packages/story-app`](packages/story-app/) | `@storyboard/story-app` | The composition root and manager facades every app shares |
| [`packages/story-engine`](packages/story-engine/) | `@storyboard/story-engine` | Runtime-agnostic core: domain policies, use cases, persistence, shared contracts |
| [`packages/story-format`](packages/story-format/) | `@storyboard/story-format` | Workspace file format: schemas, codecs, path conventions, shared fixtures |
| [`packages/story-ai`](packages/story-ai/) | `@storyboard/story-ai` | AI engine: provider registry, prompt catalog, response contracts, ports |
| [`packages/story-pipeline`](packages/story-pipeline/) | `@storyboard/story-pipeline` | Scene generation stage orchestration |
| [`packages/story-config`](packages/story-config/) | `@storyboard/story-config` | The shared home (`~/.storyboard`): config layers, the secrets file, watchers |
| [`packages/story-node`](packages/story-node/) | `@storyboard/story-node` | Node host adapters: file system, workspace locator |
| [`packages/story-sim`](packages/story-sim/) | `@storyboard/story-sim` | Quality and cost measurement: knob sweeps, reader panel, Pareto reports |

## Development

```bash
npm ci            # install every workspace from the root
npm run lint      # architecture checks, eslint, tsc, prettier for every workspace
npm test          # the three apps' tests; they run on the mock provider, no API key needed
npm run build     # bundle the extension, the CLI and the desktop app
npm run package:vsix   # package the extension (written to apps/vscode/)
npm run cli:build      # bundle the CLI (apps/cli/dist/)
npm run desktop:dev    # run the desktop app in development
```

Usage lives in the [extension](apps/vscode/README.en.md), [CLI](apps/cli/README.md) and
[desktop](apps/desktop/README.md) READMEs; the structure and file formats of a work in
[`ARCHITECTURE.md`](ARCHITECTURE.md) (Korean); the release process in [`RELEASE.md`](RELEASE.md).

## Contributing

One maintainer builds this to write their own novels. Issues and pull requests are welcome and
usually answered within days, but no response time is promised. Start with
[`CONTRIBUTING.md`](CONTRIBUTING.md) and the `good first issue` label. Contributions written with
AI agents are accepted. Security problems follow [`SECURITY.md`](SECURITY.md).

## License

Apache License 2.0 — [`LICENSE`](LICENSE)
