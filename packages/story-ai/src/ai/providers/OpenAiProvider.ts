import OpenAI from 'openai';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import {
  AiProviderError,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type ReasoningEffort,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
  acceptsReasoningEffort,
  acceptsTemperature,
  connectionCheckFailedMessage,
  generationFailedMessage,
  getProviderDisplayName,
  missingApiKeyMessage,
  missingModelMessage,
} from '@storyboard/story-model';
import { registerProviderFactory, resolveApiKeyProviderOptions } from '#ai/ai/providerFactory';

interface OpenAiModelsLike {
  readonly list: () => Promise<unknown>;
}

interface OpenAiChatCompletionsLike {
  readonly create: (request: OpenAiChatCompletionRequest) => Promise<OpenAiChatCompletionResponse>;
}

export interface OpenAiClientLike {
  readonly models: OpenAiModelsLike;
  readonly chat: {
    readonly completions: OpenAiChatCompletionsLike;
  };
}

export interface OpenAiProviderOptions {
  readonly apiKey: string | undefined;
  readonly model: string | undefined;
  readonly createClient?: (apiKey: string) => OpenAiClientLike;
}

interface OpenAiChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly reasoning_effort?: ReasoningEffort;
}

interface OpenAiChatCompletionResponse {
  readonly choices: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

export class OpenAiProvider implements AiProvider {
  public readonly id: AiProviderId = 'openai';
  public readonly displayName = getProviderDisplayName('openai');
  private readonly client: OpenAiClientLike;
  private readonly model: string;

  public constructor(options: OpenAiProviderOptions) {
    const apiKey = options.apiKey?.trim();
    const model = options.model?.trim();

    if (!apiKey) {
      throw new AiProviderError(
        'missing-api-key',
        this.id,
        missingApiKeyMessage(this.id),
      );
    }

    if (!model) {
      throw new AiProviderError('missing-model', this.id, missingModelMessage(this.id));
    }

    this.model = model;
    this.client = options.createClient?.(apiKey) ?? createDefaultOpenAiClient(apiKey);
  }

  public async checkConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      throw new AiProviderError(
        'connection-failed',
        this.id,
        connectionCheckFailedMessage(this.id),
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        temperature: acceptsTemperature(this.id, this.model) ? request.temperature : undefined,
        max_tokens: request.maxTokens,
        ...(request.reasoningEffort !== undefined && acceptsReasoningEffort(this.id, this.model)
          ? { reasoning_effort: request.reasoningEffort }
          : {}),
      });

      const text = response.choices[0]?.message?.content ?? '';
      const usage = usageFromOpenAiResponse(response);
      return aiGenerateResponseWithUsage({
        providerId: this.id,
        model: this.model,
        text,
        usage,
        isTruncated: response.choices[0]?.finish_reason === 'length',
      });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        generationFailedMessage(this.id),
        error,
      );
    }
  }
}

function usageFromOpenAiResponse(response: OpenAiChatCompletionResponse): AiUsage | undefined {
  const usage = response.usage;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  };
}

function createDefaultOpenAiClient(apiKey: string): OpenAiClientLike {
  const client = new OpenAI({ apiKey });

  return {
    models: {
      list: async (): Promise<unknown> => client.models.list(),
    },
    chat: {
      completions: {
        create: async (request): Promise<OpenAiChatCompletionResponse> =>
          client.chat.completions.create({
            model: request.model,
            messages: [...request.messages],
            temperature: request.temperature,
            max_tokens: request.max_tokens,
          }),
      },
    },
  };
}

registerProviderFactory(
  'openai',
  async (context) =>
    new OpenAiProvider({
      ...(await resolveApiKeyProviderOptions('openai', context)),
      createClient: context.clients.createOpenAiClient,
    }),
);
