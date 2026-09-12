import axios, { type AxiosInstance } from 'axios';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import { AiProviderError } from '#ai/contracts/aiProviderError';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
} from '#ai/contracts/aiTypes';
import { connectionCheckFailedMessage, generationFailedMessage, missingModelMessage } from '#ai/contracts/providerCatalog';

export interface OllamaClientLike {
  readonly get: (path: string) => Promise<unknown>;
  readonly post: (path: string, body: OllamaChatRequest) => Promise<OllamaChatResponse>;
}

export interface OllamaProviderOptions {
  readonly baseUrl: string | undefined;
  readonly model: string | undefined;
  // NOTE: 지정하지 않으면 ollama 가 모델 기본 문맥(보통 2~4천 토큰)을 쓰고, 넘치는 앞부분을
  // 오류 없이 버린다. 긴 원고를 이어 읽는 쪽에서는 그것이 «앞을 못 읽은 판정» 으로 조용히 나온다.
  readonly contextTokens?: number;
  readonly createClient?: (baseUrl: string) => OllamaClientLike;
}

interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly stream: false;
  readonly options?: {
    readonly temperature?: number;
    readonly num_predict?: number;
    readonly num_ctx?: number;
  };
}

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
}

export class OllamaProvider implements AiProvider {
  public readonly id: AiProviderId = 'ollama';
  public readonly displayName: string;
  private readonly client: OllamaClientLike;
  private readonly model: string;
  private readonly contextTokens: number | undefined;

  public constructor(options: OllamaProviderOptions) {
    const baseUrl = options.baseUrl?.trim();
    const model = options.model?.trim();

    if (!baseUrl) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        'Ollama baseUrl이 설정되어 있지 않습니다.',
      );
    }

    if (!model) {
      throw new AiProviderError('missing-model', this.id, missingModelMessage(this.id));
    }

    this.model = model;
    this.displayName = `Ollama (${model})`;
    this.contextTokens = options.contextTokens;
    this.client = options.createClient?.(baseUrl) ?? createDefaultOllamaClient(baseUrl);
  }

  public async checkConnection(): Promise<boolean> {
    try {
      await this.client.get('/api/tags');
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
      const response = await this.client.post('/api/chat', {
        model: this.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
          ...(this.contextTokens === undefined ? {} : { num_ctx: this.contextTokens }),
        },
      });

      const text = response.message?.content ?? '';
      const usage = usageFromOllamaResponse(response);
      return aiGenerateResponseWithUsage({ providerId: this.id, model: this.model, text, usage });
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

function usageFromOllamaResponse(response: OllamaChatResponse): AiUsage | undefined {
  if (response.prompt_eval_count === undefined && response.eval_count === undefined) {
    return undefined;
  }

  return {
    inputTokens: response.prompt_eval_count ?? 0,
    outputTokens: response.eval_count ?? 0,
  };
}

function createDefaultOllamaClient(baseUrl: string): OllamaClientLike {
  const client: AxiosInstance = axios.create({ baseURL: baseUrl });

  return {
    get: async (path): Promise<unknown> => (await client.get(path)).data,
    post: async (path, body): Promise<OllamaChatResponse> =>
      (await client.post(path, body)).data as OllamaChatResponse,
  };
}
