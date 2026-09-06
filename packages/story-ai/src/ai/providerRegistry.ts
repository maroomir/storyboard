import { AiProviderError } from '#ai/contracts/aiProviderError';
import { type CliRunner } from './providers/cliRunner';
import { ClaudeCodeProvider } from './providers/ClaudeCodeProvider';
import { ClaudeProvider, type ClaudeClientLike } from './providers/ClaudeProvider';
import { CodexProvider } from './providers/CodexProvider';
import { GeminiCliProvider } from './providers/GeminiCliProvider';
import { GoogleProvider, type GoogleClientLike } from './providers/GoogleProvider';
import { GrokProvider } from './providers/GrokProvider';
import { FallbackProvider, UsageLimitLatch } from './providers/FallbackProvider';
import { MockAiProvider } from './providers/MockAiProvider';
import { OllamaProvider, type OllamaClientLike } from './providers/OllamaProvider';
import { OpenAiProvider, type OpenAiClientLike } from './providers/OpenAiProvider';
import {
  type AiConnectionResult,
  type AiStreamChunk,
  aiProviderIds,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiProviderStatus,
  type AiTaskName,
  type CliProviderId,
  requiresApiKey,
} from '#ai/contracts/aiTypes';
import { SecretStore } from '#ai/ports/SecretStore';
import { ConfigBridge } from '#ai/ports/ConfigBridge';

export interface AiProviderRegistryOptions {
  readonly secretStore: SecretStore;
  readonly configBridge: ConfigBridge;
  readonly createClaudeClient?: (apiKey: string) => ClaudeClientLike;
  readonly createGoogleClient?: (apiKey: string) => GoogleClientLike;
  readonly createGrokClient?: (apiKey: string) => OpenAiClientLike;
  readonly createOllamaClient?: (baseUrl: string) => OllamaClientLike;
  readonly createOpenAiClient?: (apiKey: string) => OpenAiClientLike;
  readonly createCliRunner?: () => CliRunner;
  // When a CLI provider answers "usage limit", send the remaining calls here instead of aborting.
  // A long unattended run otherwise dies partway with half a manuscript written.
  readonly cliUsageLimitFallback?: {
    readonly providerId: AiProviderId;
    readonly onFallback?: (message: string) => void;
  };
  // A fresh install has no `defaultProvider`, and silently generating with `mock` there writes a
  // fake draft that exits clean. With this on, a task that resolves to no configured provider is
  // refused with `missing-provider` so the host can ask the author to choose one.
  readonly requireConfiguredProvider?: boolean;
}

export const missingProviderMessage =
  '기본 AI 제공자가 설정되지 않았습니다. 설정에서 제공자를 고른 뒤 다시 시도하세요.';

export class AiProviderRegistry {
  // One latch per primary provider, so the switch survives the per-call provider construction.
  private readonly usageLimitLatches = new Map<AiProviderId, UsageLimitLatch>();

  public constructor(private readonly options: AiProviderRegistryOptions) {}

  public async listProviders(): Promise<AiProviderStatus[]> {
    return Promise.all(aiProviderIds.map((providerId) => this.getProviderStatus(providerId)));
  }

  public async checkConnection(providerId: AiProviderId): Promise<AiConnectionResult> {
    try {
      await (await this.createProvider(providerId)).checkConnection();
      return { ok: true };
    } catch (error) {
      if (error instanceof AiProviderError && error.connectionReason === 'not-installed') {
        return { ok: false, reason: 'not-installed' };
      }

      throw error;
    }
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

  private async createCliProviderWithFallback(
    providerId: CliProviderId,
    modelOverride?: string,
  ): Promise<AiProvider> {
    const primary = this.createCliProvider(providerId, modelOverride);
    const fallback = this.options.cliUsageLimitFallback;

    if (!fallback || fallback.providerId === providerId) {
      return primary;
    }

    return new FallbackProvider(
      primary,
      await this.createProvider(fallback.providerId),
      fallback.onFallback,
      this.usageLimitLatchFor(providerId),
    );
  }

  private usageLimitLatchFor(providerId: AiProviderId): UsageLimitLatch {
    const existing = this.usageLimitLatches.get(providerId);
    if (existing) {
      return existing;
    }

    const latch = new UsageLimitLatch();
    this.usageLimitLatches.set(providerId, latch);
    return latch;
  }

  private async createProvider(
    providerId: AiProviderId,
    modelOverride?: string,
  ): Promise<AiProvider> {
    switch (providerId) {
      case 'mock':
        return new MockAiProvider();
      case 'openai':
      case 'claude':
      case 'google':
      case 'grok':
        return this.createApiKeyProvider(providerId, modelOverride);
      case 'ollama':
        return this.createOllamaProvider(modelOverride);
      case 'claude-code':
      case 'codex':
      case 'gemini-cli':
        return this.createCliProviderWithFallback(providerId, modelOverride);
      default:
        throw new AiProviderError(
          'provider-not-registered',
          providerId,
          `${providerId} provider는 아직 PR-3b에서 등록되지 않았습니다.`,
        );
    }
  }

  private async createApiKeyProvider(
    providerId: 'openai' | 'claude' | 'google' | 'grok',
    modelOverride?: string,
  ): Promise<AiProvider> {
    const config = this.options.configBridge.getProviderConfig(providerId);
    const apiKey = await this.options.secretStore.getApiKey(providerId);
    const model = modelOverride ?? config.model;

    switch (providerId) {
      case 'openai':
        return new OpenAiProvider({ apiKey, model, createClient: this.options.createOpenAiClient });
      case 'claude':
        return new ClaudeProvider({ apiKey, model, createClient: this.options.createClaudeClient });
      case 'google':
        return new GoogleProvider({ apiKey, model, createClient: this.options.createGoogleClient });
      case 'grok':
        return new GrokProvider({ apiKey, model, createClient: this.options.createGrokClient });
    }
  }

  private createOllamaProvider(modelOverride?: string): AiProvider {
    const config = this.options.configBridge.getProviderConfig('ollama');
    return new OllamaProvider({
      baseUrl: config.baseUrl,
      model: modelOverride ?? config.model,
      createClient: this.options.createOllamaClient,
    });
  }

  private createCliProvider(
    providerId: CliProviderId,
    modelOverride?: string,
  ): AiProvider {
    const config = this.options.configBridge.getProviderConfig(providerId);
    const settings = {
      command: config.command,
      model: modelOverride ?? config.model,
      generateTimeoutMs: config.timeoutMs,
      createRunner: this.options.createCliRunner,
    };

    switch (providerId) {
      case 'claude-code':
        return new ClaudeCodeProvider(settings);
      case 'codex':
        return new CodexProvider({ ...settings, reasoningEffort: config.reasoningEffort });
      case 'gemini-cli':
        return new GeminiCliProvider(settings);
    }
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



function getProviderDisplayName(providerId: AiProviderId): string {
  switch (providerId) {
    case 'openai':
      return 'OpenAI';
    case 'claude':
      return 'Claude';
    case 'google':
      return 'Google Gemini';
    case 'grok':
      return 'xAI Grok';
    case 'ollama':
      return 'Ollama';
    case 'claude-code':
      return 'Claude Code (CLI)';
    case 'codex':
      return 'Codex (CLI)';
    case 'gemini-cli':
      return 'Gemini CLI';
    case 'mock':
      return 'Mock AI';
  }
}
