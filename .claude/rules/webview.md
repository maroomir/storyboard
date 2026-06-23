# Webview Development

Use this file when `storyboard` introduces a webview frontend.

## Separation of Concerns

- Webview code owns rendering and local UI interactions.
- Extension-host code owns persistence, file system access, VSCode APIs, and external integrations.
- Shared contracts should live in a shared TypeScript module when the source tree exists.

## Messaging

- Define explicit message types for both directions.
- Prefer discriminated unions such as `{ type: "eventName", payload: ... }`.
- Keep request/response flows traceable with IDs if multiple concurrent operations are supported.
- Validate messages at the extension boundary before acting on them.

## Security

- Do not use inline scripts without a nonce.
- Avoid `unsafe-eval` and broad CSP permissions.
- Do not expose secrets to the webview.
- Sanitize or safely render user-provided Markdown/HTML.

## UX

- Use VSCode theme variables where possible, e.g. `var(--vscode-foreground)`.
- Keep UI responsive during long-running extension-host tasks.
- Show loading, success, cancellation, and error states explicitly.

## Reference Pattern

Cline's `webview-ui` is a useful reference for a mature React webview. For `storyboard`, start with the smallest useful UI architecture and expand only when needed.
