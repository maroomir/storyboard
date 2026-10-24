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
} from '@storyboard/story-model';
import {
  ChatGptOAuthError,
  refreshAccessToken,
  shouldRefreshTokens,
  tokensFromResponse,
  type FetchLike,
} from './chatGptOAuth';

const providerId: AiProviderId = 'chatgpt';
const baseUrl = providerCatalog.chatgpt.defaultBaseUrl;

// Responses-layer codes with a meaning of their own (errors-and-recovery, 2026-10-24). The limit
// pauses the run; a lost subscriber context means the person signs in again.
const usageLimitErrorCode = 'subscription_sharing_usage_limit_exceeded';
const invalidUserErrorCode = 'subscription_sharing_invalid_user';

export interface ChatGptProviderOptions {
  readonly model: string | undefined;
  readonly connection: OAuthConnection | undefined;
  // Where a refreshed token set goes, so the next process starts from the latest rotation.
  readonly saveConnection: (connection: OAuthConnection) => Promise<void>;
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
}

export interface ChatGptModelOption {
  readonly slug: string;
  readonly displayName: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readErrorField(body: unknown, field: 'code' | 'message'): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const error = isRecord(body.error) ? body.error : body;
  const value = error[field] ?? (field === 'message' ? body.detail : undefined);

  return typeof value === 'string' ? value : undefined;
}

// The context is sent whole on every call: a system message becomes `instructions` (a system role
// item is rejected on this route), the turns become the `input` array.
export function toResponsesInput(messages: readonly AiMessage[]): {
  readonly instructions: string | undefined;
  readonly input: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[];
} {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const input = messages
    .filter(
      (message): message is AiMessage & { readonly role: 'user' | 'assistant' } =>
        message.role !== 'system',
    )
    .map(({ role, content }) => ({ role, content }));

  return { instructions: instructions.length > 0 ? instructions : undefined, input };
}

function readUsage(value: unknown): AiUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = typeof value.input_tokens === 'number' ? value.input_tokens : 0;
  const outputTokens = typeof value.output_tokens === 'number' ? value.output_tokens : 0;
  const details = isRecord(value.input_tokens_details) ? value.input_tokens_details : {};
  const cachedTokens = typeof details.cached_tokens === 'number' ? details.cached_tokens : 0;

  return {
    inputTokens,
    outputTokens,
    ...(cachedTokens > 0 ? { cacheReadInputTokens: cachedTokens } : {}),
  };
}

// `data:` lines of a server-sent event stream, each a JSON event, in arrival order.
async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<JsonRecord> {
  const decoder = new TextDecoder();
  let buffered = '';

  // Read through the reader rather than async iteration: the browser-typed hosts' lib does not
  // declare the stream iterable, and the bytes are the same either way.
  const reader = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      const event = parseEventLine(line);
      if (event !== undefined) {
        yield event;
      }
    }
  }

  const last = parseEventLine(buffered);
  if (last !== undefined) {
    yield last;
  }
}

function parseEventLine(line: string): JsonRecord | undefined {
  const trimmed = line.trimEnd();

  if (!trimmed.startsWith('data:')) {
    return undefined;
  }

  const payload = trimmed.slice('data:'.length).trim();

  if (payload.length === 0 || payload === '[DONE]') {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// One refresh at a time per process: two calls that both see an old token must not race the
// rotating refresh token, or the second one invalidates the first's replacement.
let refreshTail: Promise<unknown> = Promise.resolve();

export class ChatGptProvider implements AiProvider {
  public readonly id: AiProviderId = providerId;
  public readonly displayName = getProviderDisplayName(providerId);
  private readonly model: string;
  private connection: OAuthConnection & {
    readonly registration: OAuthRegistration;
    readonly tokens: OAuthTokens;
  };
  private readonly saveConnection: (connection: OAuthConnection) => Promise<void>;
  private readonly fetch: FetchLike;
  private readonly now: () => Date;

  public constructor(options: ChatGptProviderOptions) {
    const model = options.model?.trim();

    if (!model) {
      throw new AiProviderError('missing-model', this.id, missingModelMessage(this.id));
    }

    const { connection } = options;
    if (connection?.tokens === undefined || connection.registration === undefined) {
      throw new AiProviderError('login-required', this.id, loginRequiredMessage(this.id));
    }

    this.model = model;
    this.connection = {
      ...connection,
      registration: connection.registration,
      tokens: connection.tokens,
    };
    this.saveConnection = options.saveConnection;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? ((): Date => new Date());
  }

  public async checkConnection(): Promise<boolean> {
    await this.listModels();
    return true;
  }

  // The models this account may call, in the server's order; the catalog row is only a suggestion.
  public async listModels(): Promise<readonly ChatGptModelOption[]> {
    const response = await this.send('/models', { method: 'GET' }, 'connection-failed');
    const body: unknown = await response.json().catch(() => undefined);
    const models = isRecord(body) && Array.isArray(body.models) ? body.models : [];

    return models.flatMap((model): ChatGptModelOption[] => {
      if (!isRecord(model) || typeof model.slug !== 'string') {
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
    const { instructions, input } = toResponsesInput(request.messages);
    // NOTE: 미리보기 경로는 temperature·top_p·max_output_tokens 를 400 으로 거부한다. 카탈로그 행이
    // 그 플래그를 false 로 들고 있어 호출자가 넘긴 값은 여기서 버려진다.
    const body = {
      model: this.model,
      ...(instructions === undefined ? {} : { instructions }),
      input,
      store: false,
      stream: true,
      ...(request.reasoningEffort !== undefined && acceptsReasoningEffort(this.id, this.model)
        ? { reasoning: { effort: request.reasoningEffort } }
        : {}),
    };

    const response = await this.send(
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

    let text = '';

    for await (const event of readServerSentEvents(response.body)) {
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
          const completed = isRecord(event.response) ? event.response : {};
          const usage = readUsage(completed.usage);

          yield {
            type: 'done',
            response: aiGenerateResponseWithUsage({
              providerId: this.id,
              model: this.model,
              text,
              ...(usage === undefined ? {} : { usage }),
              ...(event.type === 'response.incomplete' ? { isTruncated: true } : {}),
            }),
          };
          return;
        }
        case 'response.failed': {
          const failed = isRecord(event.response) ? event.response : {};
          throw this.errorFromCode(
            readErrorField(failed.error, 'code'),
            readErrorField(failed.error, 'message') ?? 'response.failed',
            undefined,
            'generation-failed',
          );
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

  // A request with a token that is fresh enough, refreshed first when it is not. A failing status
  // is turned into the error the caller can act on before any body is read as a stream.
  private async send(
    path: string,
    init: RequestInit,
    failureCode: 'connection-failed' | 'generation-failed',
  ): Promise<Response> {
    const tokens = await this.freshTokens();
    const response = await this.fetch(`${baseUrl}${path}`, {
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

    const bodyText = await response.text().catch(() => '');
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText) as unknown;
    } catch {
      // Admission failures may answer with plain text; it is shown as is.
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

    const described = [status === undefined ? undefined : `HTTP ${status}`, code, detail]
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

    const refreshed = refreshTail.then(() => this.refresh());
    refreshTail = refreshed.catch(() => undefined);
    return await refreshed;
  }

  private async refresh(): Promise<OAuthTokens> {
    // Another call may have refreshed while this one waited its turn.
    if (!shouldRefreshTokens(this.connection.tokens, this.now())) {
      return this.connection.tokens;
    }

    const { registration, tokens } = this.connection;

    try {
      const response = await refreshAccessToken(this.fetch, {
        clientId: registration.clientId,
        refreshToken: tokens.refreshToken,
      });
      const next = tokensFromResponse(response, this.now());

      this.connection = { ...this.connection, tokens: next };
      await this.saveConnection(this.connection);
      return next;
    } catch (error) {
      if (error instanceof ChatGptOAuthError && error.code === 'refresh-rejected') {
        // SECURITY: a spent refresh token is cleared so no later call retries it; the registration
        // stays so the next login reauthorizes the same client.
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
  const config = context.configBridge.getProviderConfig(providerId);
  const fetchImpl = context.clients.createChatGptFetch?.();

  return new ChatGptProvider({
    model: context.modelOverride ?? config.model,
    connection: await context.secretStore.getOAuthConnection(providerId),
    saveConnection: (connection) => context.secretStore.setOAuthConnection(providerId, connection),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
});
