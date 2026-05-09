# Storyboard

Storyboard is an AI-powered fiction IDE extension for authors writing novels and screenplays in VS Code.

Korean README: [`README.md`](README.md)

## Version 0.1.1

- **The public version of this repository is `0.1.1`.** It matches the `version` field in `package.json`.
- **This version is distributed as a VSIX for GitHub Releases.**
- Release artifacts are attached to this repository's GitHub Releases. Local development is verified with F5.

## Roadmap Notes

- **No `.picktion` import goal**: Storyboard supports workspace files such as folders and `.card` files only (`doc/concept.md`, `doc/plan.md`).
- **Extension UI language**: **`ko` by default**, **`en` optional**. This is handled with the Phase 7 i18n baseline.
- **Release channel**: VSIX files are attached to GitHub Releases.

## Current Status (Phase 6)

This project is a new VS Code extension, not a direct port of the previous Picktion web app.

- **Workspace**: one folder is one fiction project. `Storyboard: Initialize Project` creates `.storyboard/project.json` and the standard directory structure.
- **Activity Bar**: three Storyboard entry points, **Storyboard · Characters**, **Storyboard · Backgrounds**, and **Storyboard · Scenes**, each with its own dedicated webview sidebar.
- **Cards**: `character/*.card` and `background/*.card` use a custom editor. Characters and Backgrounds have separate compact list views with open and delete actions.
- **Scenes and drafts**: `scene/*.txt` maps to `draft/*.md`; drafts can be generated or regenerated through CodeLens and commands.
- **Scenes sidebar**: the Scenes view includes scene lists, status badges, and in-webview actions such as Generate and Open Draft.
- **Relation graph**: draggable character relationship visualization.
- **AI**: `mock` is the default provider, with SecretStorage API keys and OpenAI / Claude / Google / Ollama providers.

Reference documents:

- [`doc/concept.md`](doc/concept.md): product concept, workspace structure, file formats
- [`doc/plan.md`](doc/plan.md): migration plan and MVP gates
- [`doc/guide/release.md`](doc/guide/release.md): VSIX tag and release process for GitHub Releases
- [`doc/testing/extension-qa.md`](doc/testing/extension-qa.md): manual QA checklist for first-time users
- [`doc/decisions/00-repo-baseline.md`](doc/decisions/00-repo-baseline.md): initial repository baseline decision
- [`CHANGELOG.md`](CHANGELOG.md): Korean changelog
- [`CHANGELOG.en.md`](CHANGELOG.en.md): English changelog

## Product Model

- One workspace folder is **one project**.
- One `scene/*.txt` file is **one scene**.
- `character/*.card` and `background/*.card` are **YAML-based reference cards**.
- `draft/*.md` contains AI-generated drafts and is generally recommended to stay out of Git.

## Try It Locally

For detailed steps and success criteria, follow [`doc/testing/extension-qa.md`](doc/testing/extension-qa.md).

1. Open this repository in VS Code and run `npm install`.
2. Start **Run Extension** with F5 from **Run and Debug**.
3. In the Extension Development Host window, open an empty folder and run `Storyboard: Initialize Project`.
4. Use the **+** buttons in the **Characters**, **Backgrounds**, and **Scenes** views to create cards and scenes. In the compact Characters / Backgrounds lists, verify card open and delete actions. You can also generate drafts from scene CodeLens actions. The gear buttons in all three view title rows open the same Storyboard settings panel.
5. If needed, run `Storyboard: Set API Key...` to save an API key. Without a key, the `mock` provider still lets you verify the flow.

## Development

```bash
npm install
npm run build
npm run lint
npm test
```

| Script | Purpose |
| --- | --- |
| `npm run compile` | Extension host only (`src/` to `out/extension.js`) |
| `npm run build:webview` | Webview UI only (`webview-ui/` to `out/webview-ui/`) |
| `npm run build` | Both extension host and webview (`compile` + `build:webview`) |
| `npm run package:vsix` | Build and create a local-install VSIX |

If you only changed **`webview-ui/`** (sidebars, settings panel, card editor, and other React bundles), `npm run build:webview` is enough. In the Extension Development Host window, you often need to run **`Developer: Reload Window`** after the build so the new bundle is loaded.

### Extension Development Host

1. Open the repository root in VS Code.
2. Run `npm install` once.
3. Select `Run Extension` in **Run and Debug**, then press **F5**.
4. In the new window, run `Storyboard: Hello World` from `Cmd+Shift+P` / `Ctrl+Shift+P` to confirm the extension loaded.

### Initialize a Storyboard Project

In the Extension Development Host, open an empty folder or a folder that is not yet a Storyboard project, then run:

**`Storyboard: Initialize Project`**

On success, the workspace gets a structure like this. Existing `.gitignore` and README files are not overwritten; Storyboard appends only the needed block when appropriate.

```text
.storyboard/project.json
.storyboard/cache/personas/
.storyboard/cache/scenes/
character/sample.card
character/profile/
background/sample.card
background/concept/
scene/01-prologue.txt
draft/
```

### AI Providers and API Keys

- Settings keys include `storyboard.defaultProvider`, `storyboard.providers.*`, and `storyboard.tasks` (see `contributes.configuration` in `package.json`).
- API keys are stored only in **SecretStorage**, not in VS Code settings.
- Command: **`Storyboard: Set API Key...`**. Choose a provider and enter the key; confirming an empty value deletes that provider key.

The default provider is **`mock`**, which is useful for checking the pipeline and UI without an API key.

_If F5 does not start, first check that `npm run compile` or `npm run build` succeeds and that the Run configuration is selected. If UI-only changes do not appear, run `npm run build:webview` and reload the host window._

### Local VSIX Packaging

When needed for the MVP/dogfooding gate, build and package with:

```bash
npm run package:vsix
```

The generated `storyboard-0.1.1.vsix` can be installed through VS Code's **Extensions: Install from VSIX** command.

### VSIX for GitHub Releases

When a `v*.*.*` tag is pushed, GitHub Actions runs lint, tests, VSIX packaging, and attaches the VSIX plus `SHA256SUMS` to the GitHub Release.

The release tag must match the `version` in `package.json`. For example, for a `0.1.1` release, update `package.json` and `package-lock.json` to `0.1.1`, update both `CHANGELOG.md` and `CHANGELOG.en.md`, then push the `v0.1.1` tag.

See [`doc/guide/release.md`](doc/guide/release.md) for details.

### README Screenshots and GIFs (Optional)

When adding images, the recommended set is:

1. The three Storyboard Activity Bar entry points (Characters / Backgrounds / Scenes) and their sidebar views.
2. The `.card` custom editor.
3. The relation graph or a short scene-to-draft generation GIF.

## Development Rules

- [`AGENTS.md`](AGENTS.md)
- [`CLAUDE.md`](CLAUDE.md)
- [`.clinerules/`](.clinerules/)

## License

Apache License 2.0 — [`LICENSE`](LICENSE)
