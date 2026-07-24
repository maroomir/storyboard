---
name: ai-provider-workflow
description: >-
  Guides AI provider, SecretStorage, ConfigBridge, and RPC work in Storyboard:
  keys only in secrets, settings via configuration, registry boundaries, and
  deterministic tests. Use when changing packages/story-ai/src/ai, secrets,
  provider config, or webview/extension AI messaging.
---

# AI provider workflow (Storyboard)

Authoritative detail: [`ARCHITECTURE.md`](ARCHITECTURE.md) (settings and commands). Extended ADR (local): `.doc/decisions/03-ai-provider-bridge.md`.

## Policy (do not violate)

1. **Default provider** is `mock` in settings unless the product explicitly changes it—dogfood and tests without keys.
2. **API keys** live only in `vscode.ExtensionContext.secrets` via `SecretStore`, pattern `storyboard.apiKey.<provider>`. Never put keys in `settings.json`, prompts, logs, or webview payloads.
3. **Models and overrides** come from `vscode.workspace.getConfiguration("storyboard")` through **`ConfigBridge`** so provider code does not reach for VSCode config ad hoc.
4. **Override order**: `storyboard.tasks.<taskName>.provider` → `storyboard.defaultProvider` → safe fallback `mock`.
5. **Non-deterministic LLM output**: do not snapshot-test raw model responses. Test fixtures, parsing (`aiResponseParser`, `jsonRepair`, `traitsProcessor`), provider **request shaping**, and mocked HTTP/SDK boundaries.

## Implementation boundaries

- Shared RPC/message schemas: [`apps/desktop/src/shared/messaging/`](apps/desktop/src/shared/messaging/) and related zod schemas—extend in one place, validate at the extension boundary.
- Provider registry: [`packages/story-ai/src/ai/providerRegistry.ts`](packages/story-ai/src/ai/providerRegistry.ts) composes `SecretStore` + `ConfigBridge`.
- New provider: implement the shared `AiProvider` surface, register in the registry, add tests with injected clients (no real network in unit tests by default).

## Verification

```bash
npm run compile
npm test
```

Target tests under `apps/desktop/test/unit/infrastructure/ai/`, `apps/desktop/test/unit/infrastructure/secrets/`, and `apps/desktop/test/unit/infrastructure/settings/` when touching providers or config.
