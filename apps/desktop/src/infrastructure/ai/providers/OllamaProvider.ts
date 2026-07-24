import axios, { type AxiosInstance } from 'axios';

import { aiGenerateResponseWithUsage } from '../cost';
import { AiProviderError } from '../../../shared/aiProviderError';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
} from '../../../shared/aiTypes';

export interface OllamaClientLike {
  readonly get: (path: string) => Promise<unknown>;
  readonly post: (path: string, body: OllamaChatRequest) => Promise<OllamaChatResponse>;
}

export interface OllamaProviderOptions {
  readonly baseUrl: string | undefined;
  readonly model: string | undefined;
  readonly createClient?: (baseUrl: string) => OllamaClientLike;
}

interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly stream: false;
  readonly options?: {
    readonly temperature?: number;
    readonly num_predict?: number;
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
      throw new AiProviderError('missing-model', this.id, 'Ollama 모델이 설정되어 있지 않습니다.');
    }

    this.model = model;
    this.displayName = `Ollama (${model})`;
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
        'Ollama 연결 확인에 실패했습니다.',
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
        },
      });

      const text = response.message?.content ?? '';
      const usage = usageFromOllamaResponse(response);
      return aiGenerateResponseWithUsage({ providerId: this.id, model: this.model, text, usage });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        'Ollama 텍스트 생성에 실패했습니다.',
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
