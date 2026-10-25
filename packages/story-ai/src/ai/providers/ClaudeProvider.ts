import Anthropic from '@anthropic-ai/sdk';
import { type MessageParam, type TextBlockParam } from '@anthropic-ai/sdk/resources/messages';

import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import {
  AiProviderError,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type ReasoningEffort,
  type AiMessageRole,
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
  readonly output_config?: { readonly effort: ReasoningEffort };
  readonly system?: string | ReadonlyArray<TextBlockParam>;
  readonly messages: ReadonlyArray<ClaudeConversationMessage>;
}

interface ClaudeUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

type ClaudeRoleMessage = AiMessage & { readonly role: ClaudeMessageRole };

interface ClaudeMessageResponse {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly usage?: ClaudeUsage;
  readonly stop_reason?: string | null;
}

export class ClaudeProvider implements AiProvider {
  public readonly id: AiProviderId = 'claude';
  public readonly displayName: string = getProviderDisplayName('claude');
  private readonly client: ClaudeClientLike;
  private readonly model: string;

  public constructor(options: ClaudeProviderOptions) {
    const apiKey: string | undefined = options.apiKey?.trim();
    const model: string | undefined = options.model?.trim();

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
        connectionCheckFailedMessage(this.id, error),
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    try {
      const { systemPrompt, messages } = splitClaudeMessages(request.messages);
      const response: ClaudeMessageResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: acceptsTemperature(this.id, this.model) ? request.temperature : undefined,
        ...(request.reasoningEffort !== undefined && acceptsReasoningEffort(this.id, this.model)
          ? { output_config: { effort: request.reasoningEffort } }
          : {}),
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

      const text: string = extractClaudeText(response);
      const usage: AiUsage | undefined = usageFromClaudeResponse(response);
      return aiGenerateResponseWithUsage({
        providerId: this.id,
        model: this.model,
        text,
        usage,
        isTruncated: response.stop_reason === 'max_tokens',
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

function splitClaudeMessages(messages: readonly AiMessage[]): {
  readonly systemPrompt: string | undefined;
  readonly messages: ReadonlyArray<ClaudeConversationMessage>;
} {
  const systemPrompt: string = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversationMessages: ClaudeConversationMessage[] = groupConsecutiveRoles(
    messages.filter(isClaudeConversationMessage),
  ).map(toClaudeConversationMessage);

  return {
    systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
    messages:
      conversationMessages.length > 0 ? conversationMessages : [{ role: 'user', content: '' }],
  };
}

function groupConsecutiveRoles(
  messages: ReadonlyArray<ClaudeRoleMessage>,
): ReadonlyArray<ReadonlyArray<ClaudeRoleMessage>> {
  const groups: ClaudeRoleMessage[][] = [];

  for (const message of messages) {
    const last: ClaudeRoleMessage[] | undefined = groups.at(-1);
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
  const role: "user" | "assistant" = first?.role ?? 'user';
  if (group.length === 1 && first !== undefined && first.cacheBoundary !== true) {
    return { role, content: first.content };
  }

  return {
    role,
    content: group.map(
      (message): TextBlockParam => ({
        type: 'text',
        text: message.content,
        ...(message.cacheBoundary === true
          ? {
              cache_control: {
                type: 'ephemeral',
                ...(message.cacheTtl === undefined ? {} : { ttl: message.cacheTtl }),
              },
            }
          : {}),
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
  const usage: ClaudeUsage | undefined = response.usage;
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
  const client: Anthropic = new Anthropic({ apiKey });

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

registerProviderFactory(
  'claude',
  async (context) =>
    new ClaudeProvider({
      ...(await resolveApiKeyProviderOptions('claude', context)),
      createClient: context.clients.createClaudeClient,
    }),
);
