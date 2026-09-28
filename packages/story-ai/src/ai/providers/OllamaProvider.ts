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
import { registerProviderFactory } from '#ai/ai/providerFactory';

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
  // 생각(thinking) 켜기/끄기. 안 주면 ollama 의 모델 기본값이다.
  readonly think?: boolean;
  readonly createClient?: (baseUrl: string) => OllamaClientLike;
}

interface OllamaChatRequest {
  readonly model: string;
  readonly messages: readonly AiMessage[];
  readonly stream: false;
  readonly think?: boolean;
  readonly options?: {
    readonly temperature?: number;
    readonly num_predict?: number;
    readonly num_ctx?: number;
  };
}

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
    // 생각하는 모델의 생각. 본문(content)과 따로 온다.
    readonly thinking?: string;
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
  private readonly think: boolean | undefined;

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
    this.think = options.think;
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
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        stream: false,
        ...(this.think === undefined ? {} : { think: this.think }),
        options: {
          temperature: request.temperature,
          num_predict: request.maxTokens,
          ...(this.contextTokens === undefined ? {} : { num_ctx: this.contextTokens }),
        },
      });

      const text = response.message?.content ?? '';
      const thinking = response.message?.thinking ?? '';

      // NOTE: 생각하는 모델은 num_predict 를 생각으로 다 쓰면 본문 없이 돌아온다. 그것을 빈 본문으로
      // 넘기면 뼈대가 비고, 그 빈 뼈대를 «내용이 입력되지 않았습니다» 라는 한 줄로 확장한 원고가
      // 조용히 저장된다. 실측에서 gemma4 가 뼈대 프롬프트에 생각 19,000자를 쓰고 그렇게 됐다.
      if (text.trim().length === 0 && thinking.trim().length > 0) {
        throw new ThinkingExhaustedOutputError(this.model, thinking.length);
      }

      const usage = usageFromOllamaResponse(response);
      return aiGenerateResponseWithUsage({ providerId: this.id, model: this.model, text, usage });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        error instanceof ThinkingExhaustedOutputError ? error.message : generationFailedMessage(this.id),
        error,
      );
    }
  }
}

export class ThinkingExhaustedOutputError extends Error {
  public constructor(model: string, thinkingLength: number) {
    super(
      `${model} 가 생각(thinking)으로 출력 상한을 다 써서 본문이 비었습니다 (생각 ${thinkingLength.toLocaleString()}자). think 를 끄거나 출력 상한을 올리세요.`,
    );
    this.name = 'ThinkingExhaustedOutputError';
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

registerProviderFactory('ollama', (context) => {
  const config = context.configBridge.getProviderConfig('ollama');

  return new OllamaProvider({
    baseUrl: config.baseUrl,
    model: context.modelOverride ?? config.model,
    ...(config.contextTokens === undefined ? {} : { contextTokens: config.contextTokens }),
    ...(config.think === undefined ? {} : { think: config.think }),
    createClient: context.clients.createOllamaClient,
  });
});
