import OpenAI from 'openai';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import { AiProviderError } from '#ai/contracts/aiProviderError';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
} from '#ai/contracts/aiTypes';
import { type OpenAiClientLike } from './OpenAiProvider';
import { getProviderDisplayName, providerCatalog } from '#ai/contracts/providerCatalog';

// xAI serves Grok through an OpenAI-compatible chat completions endpoint, so the client shape is
// the OpenAI one; only the base URL and the key differ.
export const grokApiBaseUrl = providerCatalog.grok.defaultBaseUrl;

export interface GrokProviderOptions {
  readonly apiKey: string | undefined;
  readonly model: string | undefined;
  readonly createClient?: (apiKey: string) => OpenAiClientLike;
}

export class GrokProvider implements AiProvider {
  public readonly id: AiProviderId = 'grok';
  public readonly displayName = getProviderDisplayName('grok');
  private readonly client: OpenAiClientLike;
  private readonly model: string;

  public constructor(options: GrokProviderOptions) {
    const apiKey = options.apiKey?.trim();
    const model = options.model?.trim();

    if (!apiKey) {
      throw new AiProviderError('missing-api-key', this.id, 'xAI API 키가 설정되어 있지 않습니다.');
    }

    if (!model) {
      throw new AiProviderError('missing-model', this.id, 'Grok 모델이 설정되어 있지 않습니다.');
    }

    this.model = model;
    this.client = options.createClient?.(apiKey) ?? createDefaultGrokClient(apiKey);
  }

  public async checkConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      throw new AiProviderError(
        'connection-failed',
        this.id,
        'xAI Grok 연결 확인에 실패했습니다.',
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      });

      const text = response.choices[0]?.message?.content ?? '';
      const usage = response.usage
        ? {
            inputTokens: response.usage.prompt_tokens ?? 0,
            outputTokens: response.usage.completion_tokens ?? 0,
          }
        : undefined;
      return aiGenerateResponseWithUsage({ providerId: this.id, model: this.model, text, usage });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        'xAI Grok 텍스트 생성에 실패했습니다.',
        error,
      );
    }
  }
}

function createDefaultGrokClient(apiKey: string): OpenAiClientLike {
  const client = new OpenAI({ apiKey, baseURL: grokApiBaseUrl });

  return {
    models: {
      list: async (): Promise<unknown> => client.models.list(),
    },
    chat: {
      completions: {
        create: async (request) =>
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
