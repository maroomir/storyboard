import Anthropic from '@anthropic-ai/sdk';
import { type MessageParam, type TextBlockParam } from '@anthropic-ai/sdk/resources/messages';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import { AiProviderError } from '#ai/contracts/aiProviderError';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type AiMessageRole,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
} from '#ai/contracts/aiTypes';
import {
  acceptsTemperature,
  connectionCheckFailedMessage,
  generationFailedMessage,
  getProviderDisplayName,
  missingApiKeyMessage,
  missingModelMessage,
} from '#ai/contracts/providerCatalog';

type ClaudeMessageRole = Exclude<AiMessageRole, 'system'>;

interface ClaudeConversationMessage {
  readonly role: ClaudeMessageRole;
  readonly content: string | ReadonlyArray<TextBlockParam>;
}

interface ClaudeMessagesLike {
  readonly create: (request: ClaudeMessageRequest) => Promise<ClaudeMessageResponse>;
}

export interface ClaudeClientLike {
  readonly messages: ClaudeMessagesLike;
}

export interface ClaudeProviderOptions {
  readonly apiKey: string | undefined;
  readonly model: string | undefined;
  readonly createClient?: (apiKey: string) => ClaudeClientLike;
}

interface ClaudeMessageRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly system?: string | ReadonlyArray<TextBlockParam>;
  readonly messages: ReadonlyArray<ClaudeConversationMessage>;
}

interface ClaudeMessageResponse {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export class ClaudeProvider implements AiProvider {
  public readonly id: AiProviderId = 'claude';
  public readonly displayName = getProviderDisplayName('claude');
  private readonly client: ClaudeClientLike;
  private readonly model: string;

  public constructor(options: ClaudeProviderOptions) {
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
    this.client = options.createClient?.(apiKey) ?? createDefaultClaudeClient(apiKey);
  }

  public async checkConnection(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }],
      });

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
      const { systemPrompt, messages } = splitClaudeMessages(request.messages);
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: acceptsTemperature(this.id, this.model) ? request.temperature : undefined,
        ...(systemPrompt
          ? {
              system: [
                {
                  type: 'text',
                  text: systemPrompt,
                  cache_control: { type: 'ephemeral' },
                },
              ],
            }
          : {}),
        messages,
      });

      const text = extractClaudeText(response);
      const usage = usageFromClaudeResponse(response);
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

function splitClaudeMessages(messages: readonly AiMessage[]): {
  readonly systemPrompt: string | undefined;
  readonly messages: ReadonlyArray<ClaudeConversationMessage>;
} {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversationMessages = groupConsecutiveRoles(
    messages.filter(isClaudeConversationMessage),
  ).map(toClaudeConversationMessage);

  return {
    systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
    messages:
      conversationMessages.length > 0 ? conversationMessages : [{ role: 'user', content: '' }],
  };
}

// NOTE: 같은 역할이 이어지면 한 메시지의 블록 여러 개로 합친다. 캐시 경계가 있는 메시지는 블록에
// cache_control 을 달아 그 앞까지를 접두 캐시로 삼는다. 경계도 없고 하나뿐이면 예전처럼 문자열이다.
function groupConsecutiveRoles(
  messages: ReadonlyArray<AiMessage & { readonly role: ClaudeMessageRole }>,
): ReadonlyArray<ReadonlyArray<AiMessage & { readonly role: ClaudeMessageRole }>> {
  const groups: (AiMessage & { readonly role: ClaudeMessageRole })[][] = [];

  for (const message of messages) {
    const last = groups.at(-1);
    if (last !== undefined && last[0]?.role === message.role) {
      last.push(message);
    } else {
      groups.push([message]);
    }
  }

  return groups;
}

function toClaudeConversationMessage(
  group: ReadonlyArray<AiMessage & { readonly role: ClaudeMessageRole }>,
): ClaudeConversationMessage {
  const [first] = group;
  const role = first?.role ?? 'user';
  if (group.length === 1 && first !== undefined && first.cacheBoundary !== true) {
    return { role, content: first.content };
  }

  return {
    role,
    content: group.map(
      (message): TextBlockParam => ({
        type: 'text',
        text: message.content,
        ...(message.cacheBoundary === true ? { cache_control: { type: 'ephemeral' } } : {}),
      }),
    ),
  };
}

function isClaudeConversationMessage(
  message: AiMessage,
): message is AiMessage & { readonly role: ClaudeMessageRole } {
  return message.role === 'user' || message.role === 'assistant';
}

function usageFromClaudeResponse(response: ClaudeMessageResponse): AiUsage | undefined {
  const usage = response.usage;
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
  };
}

function extractClaudeText(response: ClaudeMessageResponse): string {
  return response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n');
}

function createDefaultClaudeClient(apiKey: string): ClaudeClientLike {
  const client = new Anthropic({ apiKey });

  return {
    messages: {
      create: async (request): Promise<ClaudeMessageResponse> => {
        const { messages, system, ...rest } = request;
        return client.messages.create({
          ...rest,
          ...(system !== undefined
            ? { system: typeof system === 'string' ? system : [...system] }
            : {}),
          messages: [...messages] as MessageParam[],
        }) as Promise<ClaudeMessageResponse>;
      },
    },
  };
}
