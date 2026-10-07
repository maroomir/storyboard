---
name: ai-provider-workflow
description: >-
  Guides AI provider, SecretStore, ConfigBridge, and RPC work in Storyboard:
  keys only in ~/.storyboard/secrets.json, settings via the shared config files,
  registry boundaries, and deterministic tests. Use when changing packages/story-ai/src/ai, secrets,
  provider config, or webview/extension AI messaging.
---

# AI provider workflow (Storyboard)

Authoritative detail: [`ARCHITECTURE.md`](ARCHITECTURE.md) (settings and commands). Extended ADR (local): `.doc/decisions/03-ai-provider-bridge.md`.

## Policy (do not violate)

1. **No implicit provider.** `ai.provider.default` must be chosen (`setup`, `config set`, the settings panel). `ConfigBridge.getDefaultProvider()` falls back to `mock` only so read-only surfaces have something to show; anything that generates checks `isDefaultProviderConfigured()` or the registry's guard, and an unknown provider is refused, never downgraded to `mock`.
2. **API keys** live only in `~/.storyboard/secrets.json` (0600), read and written through `SecretStore` over `@storyboard/story-config`'s `createFileSecretStorage`, under `storyboard.apiKey.<provider>`. Every app shares that one file. Never put keys in `config.json`, prompts, logs, or webview payloads.
3. **Settings** come from `~/.storyboard/config.json`, overridden by the workspace's `.storyboard/config.json`, through **`ConfigBridge`** over `createFileConfiguration`, so provider code never reads a config file itself. The extension contributes no VSCode `configuration`.
4. **Override order**: `tasks.<taskName>.provider|model` → `ai.provider.default` with `providers.<id>.model`. A task model with no task provider is ignored. A route is written one task at a time, to one layer (`setTaskAiConfig` / `clearTaskAiConfig`).
5. **Non-deterministic LLM output**: do not snapshot-test raw model responses. Test fixtures, parsing (`aiResponseParser`, `jsonRepair`, `traitsProcessor`), provider **request shaping**, and mocked HTTP/SDK boundaries.

## Implementation boundaries

- Shared RPC/message schemas: [`packages/story-model/src/shared/messaging/`](packages/story-model/src/shared/messaging/) and related zod schemas—extend in one place, validate at the extension boundary.
- Provider registry: [`packages/story-ai/src/ai/providerRegistry.ts`](packages/story-ai/src/ai/providerRegistry.ts) resolves a provider id through the factory table in [`providerFactory.ts`](packages/story-ai/src/ai/providerFactory.ts); `SecretStore` + `ConfigBridge` reach a provider as the factory context.
- New provider: add its catalog row (`providerCatalog.ts`), implement the shared `AiProvider` surface in `providers/<Name>Provider.ts`, call `registerProviderFactory` at the bottom of that module and import it from `providers/index.ts`. The registry itself is not edited. Add tests with injected clients (no real network in unit tests by default).

## Verification

```bash
npm run compile
npm test
```

Target tests under `apps/vscode/test/unit/infrastructure/ai/`, `apps/vscode/test/unit/infrastructure/secrets/`, and `apps/vscode/test/unit/infrastructure/settings/` when touching providers or config.
