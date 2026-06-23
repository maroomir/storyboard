# VSCode Extension Development

Follow these rules when implementing VSCode extension behavior in `storyboard`.

## Package Contributions

- `package.json` is the source of truth for extension contributions.
- Use command IDs under the `storyboard.*` namespace.
- Keep contributed commands, views, menus, configuration, and activation events aligned with runtime registration code.
- If a command is contributed in `package.json`, verify it is registered during activation or by the intended lazy activation path.

## Activation and Lifecycle

- Keep `src/extension.ts` focused on activation/deactivation and high-level wiring.
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
