# Storyboard

Storyboard is an AI-powered fiction IDE extension for authors writing novels and screenplays in VS Code.

Korean README: [`README.md`](README.md)

## Features

- Initialize one workspace folder as one Storyboard project.
- Manage character and background cards with `character/*.card` and `background/*.card`.
- Use a custom editor for `.card` files and dedicated Characters / Backgrounds sidebars.
- Manage scenes with `scene/*.txt` and generate drafts as `draft/*.md`.
- Generate and regenerate drafts from scene CodeLens actions and sidebar actions.
- Visualize character relationships with a relation graph.
- Use `mock`, OpenAI, Claude, Google, and Ollama AI providers.
- Import and export seedcoat v0.2 encrypted `.seed` files (compatible with Seeds).

## Project Model

```text
.storyboard/project.json
character/*.card
background/*.card
scene/*.txt
draft/*.md
```

- One workspace folder is one project.
- `.card` files are YAML-based reference cards.
- One `scene/*.txt` file is one scene.
- `draft/*.md` files are AI-generated drafts.

## Run Locally

```bash
npm install
npm run build
```

1. Open the repository root in VS Code.
2. Select `Run Extension` in **Run and Debug**, then press F5.
3. In the Extension Development Host window, open an empty folder.
4. Run `Storyboard: Initialize Project`.
5. Use the Characters / Backgrounds / Scenes views in the Activity Bar to create cards and scenes.

The default `mock` provider lets you verify the flow without an API key. To use a real provider, save a key with `Storyboard: Set API Key...`.

## Development

| Command | Purpose |
| --- | --- |
| `npm run compile` | Build the extension host bundle |
| `npm run build:webview` | Build the webview UI |
| `npm run build` | Build both the extension host and webview UI |
| `npm run lint` | Run ESLint and webview TypeScript checks |
| `npm test` | Run Vitest tests |
| `npm run package:vsix` | Create a local-install VSIX |

For webview-only changes, run `npm run build:webview`, then run `Developer: Reload Window` in the Extension Development Host.

## `.seed` import and export

- Commands: `Storyboard: Create Project from Seed...`, `Sync Project from Seed...`, `Export Project to Seed...`
- `.seed` files are **encrypted binaries** produced by [`@seedcoat/wasm`](https://github.com/maroomir/seedcoat) v0.2.0. Legacy plaintext JSON envelopes are not supported.
- A **passphrase is required on every import and export** (empty passphrases are rejected; never stored).
- Character `arc` / `recentDialogues` / `profile` / `attributes` and `draft/` are not included in `.seed` files.
- Policy summary: [`doc/migration/storyboard-alignment.md`](doc/migration/storyboard-alignment.md)

## Documentation

- [`doc/concept.md`](doc/concept.md): product concept and file model
- [`doc/plan.md`](doc/plan.md): development plan
- [`doc/testing/extension-qa.md`](doc/testing/extension-qa.md): manual QA checklist
- [`doc/guide/release.md`](doc/guide/release.md): release process
- [`CHANGELOG.en.md`](CHANGELOG.en.md): changelog

## License

Apache License 2.0 — [`LICENSE`](LICENSE)
