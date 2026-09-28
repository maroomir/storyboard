import type { AiProvider, AiProviderId } from '#ai/contracts/aiTypes';
import type { ConfigBridge } from '#ai/ports/ConfigBridge';
import type { SecretStore } from '#ai/ports/SecretStore';
import type { ClaudeClientLike } from './providers/ClaudeProvider';
import type { GoogleClientLike } from './providers/GoogleProvider';
import type { OllamaClientLike } from './providers/OllamaProvider';
import type { OpenAiClientLike } from './providers/OpenAiProvider';

// Test seams: a host or a spec hands in the HTTP client a provider should talk through instead of
// the real SDK. Each is optional; a provider without one builds its own.
export interface ProviderClientFactories {
  readonly createClaudeClient?: (apiKey: string) => ClaudeClientLike;
  readonly createGoogleClient?: (apiKey: string) => GoogleClientLike;
  readonly createGrokClient?: (apiKey: string) => OpenAiClientLike;
  readonly createOllamaClient?: (baseUrl: string) => OllamaClientLike;
  readonly createOpenAiClient?: (apiKey: string) => OpenAiClientLike;
}

export interface ProviderFactoryContext {
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
  readonly clients: ProviderClientFactories;
  readonly modelOverride?: string;
}

export type ProviderFactory = (context: ProviderFactoryContext) => Promise<AiProvider> | AiProvider;

const factories = new Map<AiProviderId, ProviderFactory>();

// A provider module registers itself when it is loaded, so adding a provider means adding its file
// and its catalog row; the registry never learns a new name.
export function registerProviderFactory(providerId: AiProviderId, factory: ProviderFactory): void {
  const existing = factories.get(providerId);

  if (existing !== undefined && existing !== factory) {
    throw new Error(`${providerId} provider factory is already registered.`);
  }

  factories.set(providerId, factory);
}

export function registeredProviderIds(): readonly AiProviderId[] {
  return [...factories.keys()];
}

export async function createRegisteredProvider(
  providerId: AiProviderId,
  context: ProviderFactoryContext,
): Promise<AiProvider> {
  const factory = factories.get(providerId);

  if (factory === undefined) {
    throw new Error(`${providerId} provider factory is not registered.`);
  }

  return await factory(context);
}

// The shape every API-key provider is built from: the configured model unless a call overrides it,
// and the key the secret store holds for that provider.
export async function resolveApiKeyProviderOptions(
  providerId: AiProviderId,
  context: ProviderFactoryContext,
): Promise<{ readonly apiKey: string | undefined; readonly model: string | undefined }> {
  const config = context.configBridge.getProviderConfig(providerId);
  const apiKey = await context.secretStore.getApiKey(providerId);

  return { apiKey, model: context.modelOverride ?? config.model };
}
