import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import { registerProviderFactory } from '#ai/ai/providerFactory';
import type { OAuthConnection, OAuthRegistration, OAuthTokens } from '#ai/ports/SecretStore';
import {
  AiProviderError,
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiMessage,
  type AiProvider,
  type AiProviderId,
  type AiStreamChunk,
  type AiUsage,
  acceptsReasoningEffort,
  connectionCheckFailedMessage,
  generationFailedMessage,
  getProviderDisplayName,
  loginRequiredMessage,
  missingModelMessage,
  providerCatalog,
  usageLimitMessage,
  type ReasoningEffort,
  isJsonRecord,
  type JsonRecord,
} from '@storyboard/story-model';
import {
  ChatGptOAuthClient,
  ChatGptOAuthError,
  shouldRefreshTokens,
  tokensFromResponse,
  type FetchLike,
  type TokenResponse,
} from '#ai/ai/providers/chatGptOAuth';
import type { ProviderModelConfig } from '#ai/ports/ConfigBridge';

const providerId: AiProviderId = 'chatgpt';
const baseUrl: string = providerCatalog.chatgpt.defaultBaseUrl;

const usageLimitErrorCode: string = 'subscription_sharing_usage_limit_exceeded';
const invalidUserErrorCode: string = 'subscription_sharing_invalid_user';

export interface ChatGptProviderOptions {
  readonly model: string | undefined;
  readonly connection: OAuthConnection | undefined;
  readonly loadConnection: () => Promise<OAuthConnection | undefined>;
  readonly saveConnection: (connection: OAuthConnection) => Promise<void>;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export interface ChatGptModelOption {
  readonly slug: string;
  readonly displayName: string;
}

function readErrorField(body: unknown, field: 'code' | 'message'): string | undefined {
  if (!isJsonRecord(body)) {
    return undefined;
  }

  const error: JsonRecord = isJsonRecord(body.error) ? body.error : body;
  const value: unknown = error[field] ?? (field === 'message' ? body.detail : undefined);

  return typeof value === 'string' ? value : undefined;
}

export function toResponsesInput(messages: readonly AiMessage[]): {
  readonly instructions: string | undefined;
  readonly input: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
} {
  const instructions: string = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const input: ResponsesInputMessage[] = messages
    .filter(
      (message): message is AiMessage & { readonly role: 'user' | 'assistant' } =>
        message.role !== 'system',
    )
    .map(({ role, content }): ResponsesInputMessage => ({ role, content }));

  return { instructions: instructions.length > 0 ? instructions : undefined, input };
}

interface ResponsesInputMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

interface ResponsesRequestBody {
  readonly model: string;
  readonly instructions?: string;
  readonly input: readonly ResponsesInputMessage[];
  readonly store: boolean;
  readonly stream: boolean;
  readonly reasoning?: { readonly effort: ReasoningEffort };
}

function readUsage(value: unknown): AiUsage | undefined {
  if (!isJsonRecord(value)) {
    return undefined;
  }

  const inputTokens: number = typeof value.input_tokens === 'number' ? value.input_tokens : 0;
  const outputTokens: number = typeof value.output_tokens === 'number' ? value.output_tokens : 0;
  const details: JsonRecord = isJsonRecord(value.input_tokens_details)
    ? value.input_tokens_details
    : {};
  const cachedTokens: number =
    typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;

  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens > 0 ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<JsonRecord> {
  const decoder: InstanceType<typeof TextDecoder> = new TextDecoder();
  let buffered: string = '';

  const reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    const lines: string[] = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      const event: JsonRecord | undefined = parseEventLine(line);
      if (event !== undefined) {
        yield event;
      }
    }
  }

  const last: JsonRecord | undefined = parseEventLine(buffered);
  if (last !== undefined) {
    yield last;
  }
}

function parseEventLine(line: string): JsonRecord | undefined {
  const trimmed: string = line.trimEnd();

  if (!trimmed.startsWith('data:')) {
    return undefined;
  }

  const payload: string = trimmed.slice('data:'.length).trim();

  if (payload.length === 0 || payload === '[DONE]') {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(payload);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

type SignedInConnection = OAuthConnection & {
  readonly registration: OAuthRegistration;
  readonly tokens: OAuthTokens;
};

let refreshTail: Promise<unknown> = Promise.resolve();

function runRefreshInTurn<T>(task: () => Promise<T>): Promise<T> {
  const turn: Promise<T> = refreshTail.then(task);
  refreshTail = turn.catch(() => undefined);
  return turn;
}

function isSignedIn(connection: OAuthConnection | undefined): connection is SignedInConnection {
  return connection?.tokens !== undefined && connection.registration !== undefined;
}

export class ChatGptProvider implements AiProvider {
  public readonly id: AiProviderId = providerId;
  public readonly displayName: string = getProviderDisplayName(providerId);
  private readonly model: string;
  private connection: SignedInConnection;
  private readonly loadConnection: () => Promise<OAuthConnection | undefined>;
  private readonly saveConnection: (connection: OAuthConnection) => Promise<void>;
  private readonly fetch: FetchLike;
  private readonly oauth: ChatGptOAuthClient;
  private readonly now: () => Date;

  public constructor(options: ChatGptProviderOptions) {
    const model: string | undefined = options.model?.trim();

    if (!model) {
      throw new AiProviderError('missing-model', this.id, missingModelMessage(this.id));
    }

    const { connection } = options;
    if (!isSignedIn(connection)) {
      throw new AiProviderError('login-required', this.id, loginRequiredMessage(this.id));
    }

    this.model = model;
    this.connection = connection;
    this.loadConnection = options.loadConnection;
    this.saveConnection = options.saveConnection;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.oauth = new ChatGptOAuthClient(this.fetch);
    this.now = options.now ?? ((): Date => new Date());
  }

  public async checkConnection(): Promise<boolean> {
    await this.listModels();
    return true;
  }

  public async listModels(): Promise<readonly ChatGptModelOption[]> {
    const response: Response = await this.send('/models', { method: 'GET' }, 'connection-failed');
    const body: unknown = await response.json().catch(() => undefined);
    const models: unknown[] = isJsonRecord(body) && Array.isArray(body.models) ? body.models : [];

    return models.flatMap((model): ChatGptModelOption[] => {
      if (!isJsonRecord(model) || typeof model.slug !== 'string') {
        return [];
      }
      if (model.visibility !== undefined && model.visibility !== 'list') {
        return [];
      }

      return [
        {
          slug: model.slug,
          displayName: typeof model.display_name === 'string' ? model.display_name : model.slug,
        },
      ];
    });
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    for await (const chunk of this.generateStream(request)) {
      if (chunk.type === 'done') {
        return chunk.response;
      }
    }

    throw new AiProviderError(
      'generation-failed',
      this.id,
      generationFailedMessage(this.id, '응답이 끝나지 않았습니다'),
    );
  }

  public async *generateStream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const eventStream: ReadableStream<Uint8Array> = await this.openResponseStream(request);
    let text: string = '';

    for await (const event of readServerSentEvents(eventStream)) {
      switch (event.type) {
        case 'response.output_text.delta': {
          if (typeof event.delta === 'string') {
            text += event.delta;
            yield { type: 'text-delta', delta: event.delta };
          }
          break;
        }
        case 'response.completed':
        case 'response.incomplete': {
          yield this.createDoneChunk(event, text);
          return;
        }
        case 'response.failed': {
          throw this.errorFromFailedEvent(event);
        }
        case 'error': {
          throw this.errorFromCode(
            readErrorField(event, 'code'),
            readErrorField(event, 'message') ?? 'error',
            undefined,
            'generation-failed',
          );
        }
        default:
          break;
      }
    }

    throw new AiProviderError(
      'generation-failed',
      this.id,
      generationFailedMessage(this.id, 'response.completed 없이 스트림이 끝났습니다'),
    );
  }

  private buildResponsesRequestBody(request: AiGenerateRequest): ResponsesRequestBody {
    const { instructions, input } = toResponsesInput(request.messages);

    return {
      model: this.model,
      ...(instructions === undefined ? {} : { instructions }),
      input,
      store: false,
      stream: true,
      ...(request.reasoningEffort !== undefined && acceptsReasoningEffort(this.id, this.model)
        ? { reasoning: { effort: request.reasoningEffort } }
        : {}),
    };
  }

  private async openResponseStream(
    request: AiGenerateRequest,
  ): Promise<ReadableStream<Uint8Array>> {
    const body: ResponsesRequestBody = this.buildResponsesRequestBody(request);
    const response: Response = await this.send(
      '/responses',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      },
      'generation-failed',
    );

    if (response.body === null) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        generationFailedMessage(this.id, '응답 본문이 없습니다'),
      );
    }

    return response.body;
  }

  private createDoneChunk(event: JsonRecord, text: string): AiStreamChunk {
    const completed: JsonRecord = isJsonRecord(event.response) ? event.response : {};
    const usage: AiUsage | undefined = readUsage(completed.usage);

    return {
      type: 'done',
      response: aiGenerateResponseWithUsage({
        providerId: this.id,
        model: this.model,
        text,
        ...(usage === undefined ? {} : { usage }),
        ...(event.type === 'response.incomplete' ? { isTruncated: true } : {}),
      }),
    };
  }

  private errorFromFailedEvent(event: JsonRecord): AiProviderError {
    const failed: JsonRecord = isJsonRecord(event.response) ? event.response : {};

    return this.errorFromCode(
      readErrorField(failed.error, 'code'),
      readErrorField(failed.error, 'message') ?? 'response.failed',
      undefined,
      'generation-failed',
    );
  }

  private async send(
    path: string,
    init: RequestInit,
    failureCode: 'connection-failed' | 'generation-failed',
  ): Promise<Response> {
    const tokens: OAuthTokens = await this.freshTokens();
    const response: Response = await this.fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${tokens.accessToken}`,
      },
    }).catch((error: unknown) => {
      throw new AiProviderError(
        failureCode,
        this.id,
        failureCode === 'connection-failed'
          ? connectionCheckFailedMessage(this.id, error)
          : generationFailedMessage(this.id, error),
        error,
      );
    });

    if (response.ok) {
      return response;
    }

    const bodyText: string = await response.text().catch(() => '');
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      body = bodyText;
    }

    throw this.errorFromCode(
      readErrorField(body, 'code'),
      readErrorField(body, 'message') ?? bodyText,
      response.status,
      failureCode,
    );
  }

  private errorFromCode(
    code: string | undefined,
    detail: string,
    status: number | undefined,
    failureCode: 'connection-failed' | 'generation-failed',
  ): AiProviderError {
    if (code === usageLimitErrorCode || status === 429) {
      return new AiProviderError('usage-limit', this.id, usageLimitMessage(this.id));
    }

    if (code === invalidUserErrorCode || status === 401) {
      return new AiProviderError('login-required', this.id, loginRequiredMessage(this.id));
    }

    const described: string = [status === undefined ? undefined : `HTTP ${status}`, code, detail]
      .filter(Boolean)
      .join(' · ');

    return new AiProviderError(
      failureCode,
      this.id,
      failureCode === 'connection-failed'
        ? connectionCheckFailedMessage(this.id, described)
        : generationFailedMessage(this.id, described),
    );
  }

  private async freshTokens(): Promise<OAuthTokens> {
    if (!shouldRefreshTokens(this.connection.tokens, this.now())) {
      return this.connection.tokens;
    }

    return await runRefreshInTurn(() => this.refreshUnlessAnotherCallDid());
  }

  private async refreshUnlessAnotherCallDid(): Promise<OAuthTokens> {
    const stored: OAuthConnection | undefined = await this.loadConnection();
    if (!isSignedIn(stored)) {
      throw new AiProviderError('login-required', this.id, loginRequiredMessage(this.id));
    }

    this.connection = stored;
    if (!shouldRefreshTokens(stored.tokens, this.now())) {
      return stored.tokens;
    }

    return await this.refresh();
  }

  private async refresh(): Promise<OAuthTokens> {
    const { registration, tokens } = this.connection;

    try {
      const response: TokenResponse = await this.oauth.refreshAccessToken({
        clientId: registration.clientId,
        refreshToken: tokens.refreshToken,
      });
      const next: OAuthTokens = tokensFromResponse(response, this.now());

      this.connection = { ...this.connection, tokens: next };
      await this.saveConnection(this.connection);
      return next;
    } catch (error) {
      if (error instanceof ChatGptOAuthError && error.code === 'refresh-rejected') {
        await this.saveConnection({ hostId: this.connection.hostId, registration });
        throw new AiProviderError('login-required', this.id, loginRequiredMessage(this.id), error);
      }

      throw new AiProviderError(
        'connection-failed',
        this.id,
        connectionCheckFailedMessage(this.id, error),
        error,
      );
    }
  }
}

registerProviderFactory(providerId, async (context) => {
  const config: ProviderModelConfig = context.configBridge.getProviderConfig(providerId);
  const fetchImpl:
    | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>)
    | undefined = context.clients.createChatGptFetch?.();

  return new ChatGptProvider({
    model: context.modelOverride ?? config.model,
    connection: await context.secretStore.getOAuthConnection(providerId),
    loadConnection: (): Promise<OAuthConnection | undefined> =>
      context.secretStore.getOAuthConnection(providerId),
    saveConnection: (connection: OAuthConnection): Promise<void> =>
      context.secretStore.setOAuthConnection(providerId, connection),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
});
