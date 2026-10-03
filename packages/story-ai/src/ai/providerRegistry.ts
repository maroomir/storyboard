import {
  getProviderDisplayName,
  AiProviderError,
  type AiConnectionResult,
  type AiStreamChunk,
  aiProviderIds,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiProviderStatus,
  type AiTaskName,
  requiresApiKey,
} from '@storyboard/story-model';
import './providers';
import { createRegisteredProvider, type ProviderClientFactories } from './providerFactory';
import { SecretStore } from '#ai/ports/SecretStore';
import { ConfigBridge } from '#ai/ports/ConfigBridge';
import type { PromptVariantId } from './prompts/types';

export interface AiProviderRegistryOptions extends ProviderClientFactories {
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  // A fresh install has no `defaultProvider`, and silently generating with `mock` there writes a
  // fake draft that exits clean. With this on, a task that resolves to no configured provider is
  // refused with `missing-provider` so the host can ask the author to choose one.
  readonly requireConfiguredProvider?: boolean;
}

export const missingProviderMessage =
  '기본 AI 제공자가 설정되지 않았습니다. 설정에서 제공자를 고른 뒤 다시 시도하세요.';

export class AiProviderRegistry {
  public constructor(private readonly options: AiProviderRegistryOptions) {}

  public async listProviders(): Promise<AiProviderStatus[]> {
    return Promise.all(aiProviderIds.map((providerId) => this.getProviderStatus(providerId)));
  }

  public async checkConnection(providerId: AiProviderId): Promise<AiConnectionResult> {
    await (await this.createProvider(providerId)).checkConnection();
    return { ok: true };
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { providerId, model } = this.getTaskAiConfig(request.taskName);
    return this.generateWithProvider(providerId, request, model);
  }

  public generateStream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const { providerId, model } = this.getTaskAiConfig(request.taskName);
    return this.generateStreamWithProvider(providerId, request, model);
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    this.assertTaskProviderConfigured(taskName);
    return this.options.configBridge.getTaskProvider(taskName);
  }

  public getTaskAiConfig(taskName: AiTaskName): {
    readonly providerId: AiProviderId;
    readonly model: string;
  } {
    this.assertTaskProviderConfigured(taskName);
    return this.options.configBridge.getTaskAiConfig(taskName);
  }

  public getPromptVariantOverride(): PromptVariantId | undefined {
    return this.options.configBridge.getPromptVariantOverride();
  }

  public isTaskProviderConfigured(taskName: AiTaskName): boolean {
    const { configBridge } = this.options;

    return (
      configBridge.getTaskProviderOverride(taskName) !== null ||
      configBridge.isDefaultProviderConfigured()
    );
  }

  private assertTaskProviderConfigured(taskName: AiTaskName): void {
    if (this.options.requireConfiguredProvider && !this.isTaskProviderConfigured(taskName)) {
      throw new AiProviderError('missing-provider', 'mock', missingProviderMessage);
    }
  }

  public async generateWithProvider(
    providerId: AiProviderId,
    request: AiGenerateRequest,
    modelOverride?: string,
  ): Promise<AiGenerateResponse> {
    return (await this.createProvider(providerId, modelOverride)).generate(request);
  }

  public async *generateStreamWithProvider(
    providerId: AiProviderId,
    request: AiGenerateRequest,
    modelOverride?: string,
  ): AsyncIterable<AiStreamChunk> {
    const provider = await this.createProvider(providerId, modelOverride);

    if (provider.generateStream) {
      yield* provider.generateStream(request);
      return;
    }

    const response = await provider.generate(request);
    if (response.text.length > 0) {
      yield { type: 'text-delta', delta: response.text };
    }
    yield { type: 'done', response };
  }

  private async createProvider(
    providerId: AiProviderId,
    modelOverride?: string,
  ): Promise<AiProvider> {
    const {
      secretStore,
      configBridge,
      requireConfiguredProvider: _guard,
      ...clients
    } = this.options;

    return await createRegisteredProvider(providerId, {
      configBridge,
      secretStore,
      clients,
      ...(modelOverride === undefined ? {} : { modelOverride }),
    });
  }

  private async getProviderStatus(providerId: AiProviderId): Promise<AiProviderStatus> {
    const config = this.options.configBridge.getProviderConfig(providerId);
    const hasApiKey = requiresApiKey(providerId)
      ? await this.options.secretStore.hasApiKey(providerId)
      : true;

    return {
      providerId,
      displayName: getProviderDisplayName(providerId),
      model: config.model,
      hasApiKey,
      isAvailable: true,
    };
  }
}

export function createAiProviderRegistry(options: AiProviderRegistryOptions): AiProviderRegistry {
  return new AiProviderRegistry(options);
}
