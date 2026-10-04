import { GoogleGenerativeAI } from '@google/generative-ai';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import {
  AiProviderError,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
  acceptsTemperature,
  connectionCheckFailedMessage,
  generationFailedMessage,
  getProviderDisplayName,
  missingApiKeyMessage,
  missingModelMessage,
} from '@storyboard/story-model';
import { registerProviderFactory, resolveApiKeyProviderOptions } from '#ai/ai/providerFactory';

interface GoogleGenerativeModelLike {
  readonly generateContent: (prompt: string) => Promise<GoogleGenerateContentResultLike>;
}

interface GoogleGenerateContentResultLike {
  readonly response: {
    readonly text: () => string;
    readonly usageMetadata?: {
      readonly promptTokenCount?: number;
      readonly candidatesTokenCount?: number;
    };
    readonly candidates?: ReadonlyArray<{ readonly finishReason?: string }>;
  };
}

export interface GoogleClientLike {
  readonly getGenerativeModel: (options: GoogleModelOptions) => GoogleGenerativeModelLike;
}

export interface GoogleProviderOptions {
  readonly apiKey: string | undefined;
  readonly model: string | undefined;
  readonly createClient?: (apiKey: string) => GoogleClientLike;
}

interface GoogleModelOptions {
  readonly model: string;
  readonly systemInstruction?: string;
  readonly generationConfig?: {
    readonly temperature?: number;
    readonly maxOutputTokens?: number;
  };
}

export class GoogleProvider implements AiProvider {
  public readonly id: AiProviderId = 'google';
  public readonly displayName = getProviderDisplayName('google');
  private readonly client: GoogleClientLike;
  private readonly model: string;

  public constructor(options: GoogleProviderOptions) {
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
    this.client = options.createClient?.(apiKey) ?? createDefaultGoogleClient(apiKey);
  }

  public async checkConnection(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });
      const result = await model.generateContent('test');
      return result.response.text().length > 0;
    } catch (error) {
      throw new AiProviderError(
        'connection-failed',
        this.id,
        connectionCheckFailedMessage(this.id, error),
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const systemInstruction = request.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');

      const model = this.client.getGenerativeModel({
        model: this.model,
        ...(systemInstruction.length > 0 ? { systemInstruction } : {}),
        generationConfig: {
          temperature: acceptsTemperature(this.id, this.model) ? request.temperature : undefined,
          maxOutputTokens: request.maxTokens,
        },
      });
      const result = await model.generateContent(createGoogleConversationPrompt(request));

      const text = result.response.text();
      const usage = usageFromGoogleResult(result);
      return aiGenerateResponseWithUsage({
        providerId: this.id,
        model: this.model,
        text,
        usage,
        isTruncated: result.response.candidates?.[0]?.finishReason === 'MAX_TOKENS',
      });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        generationFailedMessage(this.id, error),
        error,
      );
    }
  }
}

function usageFromGoogleResult(result: GoogleGenerateContentResultLike): AiUsage | undefined {
  const meta = result.response.usageMetadata;
  if (!meta) {
    return undefined;
  }

  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
  };
}

function createGoogleConversationPrompt(request: AiGenerateRequest): string {
  return request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.content)
    .join('\n\n');
}

function createDefaultGoogleClient(apiKey: string): GoogleClientLike {
  const client = new GoogleGenerativeAI(apiKey);

  return {
    getGenerativeModel: (options): GoogleGenerativeModelLike => client.getGenerativeModel(options),
  };
}

registerProviderFactory(
  'google',
  async (context) =>
    new GoogleProvider({
      ...(await resolveApiKeyProviderOptions('google', context)),
      createClient: context.clients.createGoogleClient,
    }),
);
