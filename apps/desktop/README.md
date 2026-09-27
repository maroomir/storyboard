# Storyboard (desktop)

Storyboard for writers. The manuscript is the centre of the screen; the cards, the facts the story
has established and the review notes sit in the margin; the novel pipeline runs from a drawer that
shows its stages, every scene, the progress log and what the run costs.

It runs the same engine as the `storyboard` CLI and the VSCode extension and reads the same files,
so a work can move between them freely. Settings and API keys are shared through `~/.storyboard/`.

## What it does

- **Start a work in three steps** — title, genre and readers; point of view, structure and length;
  one paragraph about the story. The app creates the folder, the story contract and the version
  history.
- **Write and edit on the page** — type directly (saved as you pause), or select a passage, tell the
  AI what to change, compare, and replace. The version from before an editing session stays in
  `.draft/`.
- **Run the whole novel from the drawer** — choose how often to be asked (never, after the outline,
  every chapter, before rewrites), pause at the end of the scene in progress, resume later. A budget
  in dollars pauses the run the same way.
- **Keep the story bible** — characters, settings, narrators and the canon facts, as forms.
- **Go back to any version** — the app saves a version whenever it or you change the work. Restoring
  one keeps the current state as a version too.
- **Korean and English** — follows the system language; change it in Settings.

While a run is active — here, in the CLI or in the extension — the work is read-only in the app.

## Generated text and provider policies

- **Check what the AI asserts.** Drafts, revisions, review notes and story-bible suggestions are
  model output. Treat any factual claim in them (history, geography, medicine, law, real people or
  places) as unverified until you have checked it yourself. If you hand this app to other writers,
  pass this notice on to them.
- **The provider's usage policy applies to the manuscript.** `openai`, `claude`, `google` and `grok`
  each apply their own content rules to what you generate (for example sexually explicit scenes,
  sexual content involving minors, or material that promotes violence). A request that crosses the
  line is refused by the provider, and repeated violations can restrict the API key or the account.
  `ollama` runs on your machine and no such policy applies.

## Develop

Needs Node 22.12 or newer (Electron 44).

```bash
npm install
npm run desktop:dev        # from the repo root: Vite with hot reload + Electron
```

From `apps/desktop`:

```bash
npm run lint      # ESLint, both typechecks, architecture check
npm test          # main side through the real IPC router (mock provider, real git), renderer logic
npm run build     # dist/main, dist/preload, dist/renderer
npm run package   # installers into release/ (unsigned unless signing variables are set)
```

The GUI has no automated end-to-end test; check it by hand with [DESKTOP_QA.md](DESKTOP_QA.md).
The rules the app must keep are in `.claude/rules/desktop.md`.
