import {
  getProviderDisplayName,
  AiProviderError,
  type AiConnectionResult,
  type AiStreamChunk,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiProviderStatus,
  type AiTaskName,
  getProviderTransport,
  hiddenProviderRunWarning,
  isHiddenProvider,
  requiresApiKey,
  requiresSubscriptionRiskNotice,
  riskNotAcknowledgedMessage,
  unknownProviderMessage,
} from '@storyboard/story-model';
import '#ai/ai/providers/index';
import { createRegisteredProvider, type ProviderClientFactories } from '#ai/ai/providerFactory';
import { SecretStore } from '#ai/ports/SecretStore';
import {
  ConfigBridge,
  type ProviderModelConfig,
  type TaskAiConfigResolved,
} from '#ai/ports/ConfigBridge';
import type { PromptVariantId } from '#ai/ai/prompts/types';

export interface AiProviderRegistryOptions extends ProviderClientFactories {
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly requireConfiguredProvider?: boolean;
  readonly onRiskWarning?: (message: string) => void;
}

export const missingProviderMessage: string =
  '기본 AI 제공자가 설정되지 않았습니다. 설정에서 제공자를 고른 뒤 다시 시도하세요.';

export class AiProviderRegistry {
  public constructor(private readonly options: AiProviderRegistryOptions) {}

  private readonly warnedProviderIds: Set<AiProviderId> = new Set<AiProviderId>();

  public async listProviders(): Promise<AiProviderStatus[]> {
    return Promise.all(
      this.options.configBridge
        .getAvailableProviderIds()
        .map((providerId) => this.getProviderStatus(providerId)),
    );
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

  public getTaskAiConfig(taskName: AiTaskName): TaskAiConfigResolved {
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
    const provider: AiProvider = await this.createProvider(providerId, modelOverride);

    if (provider.generateStream) {
      yield* provider.generateStream(request);
      return;
    }

    const response: AiGenerateResponse = await provider.generate(request);
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
      onRiskWarning: _warn,
      ...clients
    } = this.options;

    this.assertHiddenProviderAllowed(providerId);

    return await createRegisteredProvider(providerId, {
      configBridge,
      secretStore,
      clients,
      ...(modelOverride === undefined ? {} : { modelOverride }),
    });
  }

  private assertHiddenProviderAllowed(providerId: AiProviderId): void {
    if (!isHiddenProvider(providerId)) {
      return;
    }

    const { configBridge, onRiskWarning } = this.options;

    if (!configBridge.isHiddenProviderEnabled(providerId)) {
      throw new AiProviderError(
        'provider-not-enabled',
        providerId,
        unknownProviderMessage(providerId),
      );
    }

    if (
      requiresSubscriptionRiskNotice(providerId) &&
      !configBridge.isHiddenProviderRiskAcknowledged(providerId)
    ) {
      throw new AiProviderError(
        'risk-not-acknowledged',
        providerId,
        riskNotAcknowledgedMessage(providerId),
      );
    }

    if (!this.warnedProviderIds.has(providerId)) {
      this.warnedProviderIds.add(providerId);
      onRiskWarning?.(hiddenProviderRunWarning(providerId));
    }
  }

  private async hasCredential(providerId: AiProviderId): Promise<boolean> {
    if (requiresApiKey(providerId)) {
      return await this.options.secretStore.hasApiKey(providerId);
    }

    if (getProviderTransport(providerId) === 'oauth') {
      return (await this.options.secretStore.getOAuthConnection(providerId))?.tokens !== undefined;
    }

    return true;
  }

  private async getProviderStatus(providerId: AiProviderId): Promise<AiProviderStatus> {
    const config: ProviderModelConfig = this.options.configBridge.getProviderConfig(providerId);
    const hasApiKey: boolean = await this.hasCredential(providerId);

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
