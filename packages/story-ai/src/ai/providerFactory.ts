import type { AiProvider, AiProviderId } from '@storyboard/story-model';
import type { ConfigBridge, ProviderModelConfig } from '#ai/ports/ConfigBridge';
import type { ICliRunner } from '#ai/ports/cliRunner';
import type { SecretStore } from '#ai/ports/SecretStore';
import type { FetchLike } from './providers/chatGptOAuth';
import type { ClaudeClientLike } from './providers/ClaudeProvider';
import type { GoogleClientLike } from './providers/GoogleProvider';
import type { OllamaClientLike } from './providers/OllamaProvider';
import type { OpenAiClientLike } from './providers/OpenAiProvider';

export interface ProviderClientFactories {
  readonly createCliRunner?: () => ICliRunner;
  readonly createChatGptFetch?: () => FetchLike;
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

const factories: Map<AiProviderId, ProviderFactory> = new Map<AiProviderId, ProviderFactory>();

export function registerProviderFactory(providerId: AiProviderId, factory: ProviderFactory): void {
  const existing: ProviderFactory | undefined = factories.get(providerId);

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
  const factory: ProviderFactory | undefined = factories.get(providerId);

  if (factory === undefined) {
    throw new Error(`${providerId} provider factory is not registered.`);
  }

  return await factory(context);
}

export async function resolveApiKeyProviderOptions(
  providerId: AiProviderId,
  context: ProviderFactoryContext,
): Promise<{ readonly apiKey: string | undefined; readonly model: string | undefined }> {
  const config: ProviderModelConfig = context.configBridge.getProviderConfig(providerId);
  const apiKey: string | undefined = await context.secretStore.getApiKey(providerId);

  return { apiKey, model: context.modelOverride ?? config.model };
}
