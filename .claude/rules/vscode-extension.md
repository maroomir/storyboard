# VSCode Extension Development

Follow these rules when implementing VSCode extension behavior in `storyboard`.

## Package Contributions

- `apps/vscode/package.json` is the source of truth for extension contributions.
- Use command IDs under the `storyboard.*` namespace.
- Keep contributed commands, views, menus, configuration, and activation events aligned with runtime registration code.
- If a command is contributed in `apps/vscode/package.json`, verify it is registered during activation or by the intended lazy activation path.

## Activation and Lifecycle

- Keep `apps/vscode/src/extension.ts` focused on activation/deactivation and high-level wiring.
- A contributed command is a class implementing `IExtensionCommand` (`readonly id` from
  `contributionIds.ts`, `run(...)`, its dependencies through the constructor) in
  `presentation/commands/<name>Command.ts`; a bootstrap module lists its command instances and the
  bootstrap `CommandRegistrar` is the one place `vscode.commands.registerCommand` is called for them.
  Its steps are `private` methods; a flow two or three commands share is a `protected` verb of one
  abstract `<Flow>CommandBase` they extend (`GenerateDraftCommandBase`), never a module function
  that takes the dependencies.
- A provider (diagnostics, hover, sidebar, custom editor, inline completion, rename participant) is
  a class with `register(): vscode.Disposable`; the bootstrap module builds it and pushes what it
  returns. No `registerXCommand`/`registerXProvider` functions.
- Push disposables into `context.subscriptions`.
- Dispose watchers, webview panels, event listeners, terminals, and long-running resources explicitly.
- Avoid doing expensive work on activation unless required for the activation event.

## VSCode API Boundaries

- VSCode APIs belong in extension-host code only.
- Do not import `vscode` from webview code.
- Wrap VSCode-specific logic behind services where it improves testability.

## Webviews

- Always define a Content Security Policy.
- Use nonces for scripts.
- Use `webview.asWebviewUri(...)` for local resources.
- Use message passing for all extension ↔ webview interactions.
- Treat messages from webview as untrusted input and validate important payloads.

## Error Handling

- Surface user-actionable errors through VSCode notifications or webview UI.
- Log enough context for debugging, but never log secrets.
- Prefer graceful degradation over failing activation entirely.
