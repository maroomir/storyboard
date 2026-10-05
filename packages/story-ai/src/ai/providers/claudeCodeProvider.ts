import { aiGenerateResponseWithUsage } from '#ai/ai/cost';
import { registerProviderFactory } from '#ai/ai/providerFactory';
import type { CliRunResult, ICliRunner } from '#ai/ports/cliRunner';
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
  missingModelMessage,
} from '@storyboard/story-model';
import { NodeCliRunner } from './nodeCliRunner';

const providerId: AiProviderId = 'claude-code';
const defaultCommand = 'claude';
const defaultTimeoutMs = 10 * 60 * 1000;
const connectionCheckTimeoutMs = 20 * 1000;

// SECURITY: the child signs in with whatever the user's own `claude` login holds. A key in the
// parent's environment would silently turn a subscription call into a metered one, so the child
// never inherits these.
const withheldEnvironment = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;

// NOTE: 2.1.289 에서 실측한 조합이다. 도구·MCP·슬래시 명령·사용자 설정을 모두 끄지 않으면 호출마다
// 2만 토큰이 넘는 코딩 에이전트 문맥이 실린다. `--bare` 는 구독 로그인을 읽지 않으므로 쓰지 않는다.
const fixedArguments = [
  '-p',
  '--tools',
  '',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
] as const;

// The CLI replaces its coding-agent persona only when it is handed a system prompt of its own.
const fallbackSystemPrompt = '요청받은 글만 답한다. 도구를 쓰지 않는다.';

const roleLabels = { user: '사용자', assistant: '어시스턴트' } as const;

export interface ClaudeCodeProviderOptions {
  readonly model: string | undefined;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly runner?: ICliRunner;
}

interface CliResultEvent {
  readonly isError: boolean;
  readonly text: string;
  readonly apiErrorStatus?: number;
  readonly stopReason?: string;
  readonly usage?: AiUsage;
}

interface CliOutput {
  result?: CliResultEvent;
  isRateLimited: boolean;
  rateLimitResetsAt?: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonLine(line: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    // The CLI may print a notice that is not an event; only events are read.
    return undefined;
  }
}

function readTokenCount(usage: JsonRecord, key: string): number {
  const value = usage[key];
  return typeof value === 'number' ? value : 0;
}

function readUsage(value: unknown): AiUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    inputTokens: readTokenCount(value, 'input_tokens'),
    outputTokens: readTokenCount(value, 'output_tokens'),
    cacheReadInputTokens: readTokenCount(value, 'cache_read_input_tokens'),
    cacheCreationInputTokens: readTokenCount(value, 'cache_creation_input_tokens'),
  };
}

function readTextDelta(event: JsonRecord): string | undefined {
  if (event.type !== 'stream_event' || !isRecord(event.event)) {
    return undefined;
  }

  const delta = event.event.delta;

  return event.event.type === 'content_block_delta' &&
    isRecord(delta) &&
    delta.type === 'text_delta' &&
    typeof delta.text === 'string'
    ? delta.text
    : undefined;
}

function recordEvent(output: CliOutput, event: JsonRecord): void {
  if (event.type === 'rate_limit_event' && isRecord(event.rate_limit_info)) {
    const { status, resetsAt } = event.rate_limit_info;

    if (status === 'rejected') {
      output.isRateLimited = true;
    }

    if (typeof resetsAt === 'number') {
      output.rateLimitResetsAt = resetsAt;
    }

    return;
  }

  if (event.type !== 'result') {
    return;
  }

  const usage = readUsage(event.usage);

  output.result = {
    isError: event.is_error === true,
    text: typeof event.result === 'string' ? event.result : '',
    ...(typeof event.api_error_status === 'number'
      ? { apiErrorStatus: event.api_error_status }
      : {}),
    ...(typeof event.stop_reason === 'string' ? { stopReason: event.stop_reason } : {}),
    ...(usage === undefined ? {} : { usage }),
  };
}

// The CLI takes one system prompt and one prompt on stdin, so a conversation is written out as a
// labelled transcript; a single user message goes through untouched.
export function splitCliPrompt(messages: readonly AiMessage[]): {
  readonly systemPrompt: string;
  readonly prompt: string;
} {
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const turns = messages.filter((message) => message.role !== 'system');
  const [onlyTurn] = turns;

  const prompt =
    turns.length === 1 && onlyTurn?.role === 'user'
      ? onlyTurn.content
      : turns
          .map((turn) => `[${roleLabels[turn.role as keyof typeof roleLabels]}]\n${turn.content}`)
          .join('\n\n');

  return { systemPrompt: systemPrompt.length > 0 ? systemPrompt : fallbackSystemPrompt, prompt };
}

// One child at a time, across every provider instance in this process: a subscription is priced for
// a person typing, not for a pipeline fanning out.
let queueTail: Promise<void> = Promise.resolve();

function runInTurn<T>(task: () => Promise<T>): Promise<T> {
  const turn = queueTail.then(task);
  queueTail = turn.then(
    () => undefined,
    () => undefined,
  );
  return turn;
}

function formatResetTime(resetsAtSeconds: number | undefined): string {
  return resetsAtSeconds === undefined
    ? ''
    : ` 한도는 ${new Date(resetsAtSeconds * 1000).toLocaleString('ko-KR')} 에 풀립니다.`;
}

export class ClaudeCodeProvider implements AiProvider {
  public readonly id: AiProviderId = providerId;
  public readonly displayName = getProviderDisplayName(providerId);
  private readonly model: string;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly runner: ICliRunner;

  public constructor(options: ClaudeCodeProviderOptions) {
    const model = options.model?.trim();

    if (!model) {
      throw new AiProviderError('missing-model', this.id, missingModelMessage(this.id));
    }

    this.model = model;
    this.command = options.command ?? defaultCommand;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.runner = options.runner ?? new NodeCliRunner();
  }

  // NOTE: 로그인 여부는 실행 파일 스스로 답한다(`claude auth status --json` 의 loggedIn). 이쪽은 그
  // 답만 읽고, 로그인 정보가 어디에 어떻게 있는지는 알지 못한다.
  public async checkConnection(): Promise<boolean> {
    let status = '';
    const run = await this.runner.run({
      command: this.command,
      args: ['auth', 'status', '--json'],
      stdin: '',
      timeoutMs: connectionCheckTimeoutMs,
      withoutEnvironment: withheldEnvironment,
      onStdoutLine: (line) => {
        status += line;
      },
    });

    this.assertStarted(run);

    if (run.failure === 'timeout') {
      throw new AiProviderError(
        'connection-failed',
        this.id,
        connectionCheckFailedMessage(this.id),
      );
    }

    if (run.exitCode !== 0 || parseJsonLine(status)?.loggedIn !== true) {
      throw this.notLoggedInError();
    }

    return true;
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    return runInTurn(() => this.runGeneration(request));
  }

  public async *generateStream(request: AiGenerateRequest): AsyncIterable<AiStreamChunk> {
    const deltas: string[] = [];
    let wake: (() => void) | undefined;
    let isFinished = false;
    const abort = new AbortController();

    const generation = runInTurn(() =>
      this.runGeneration(
        request,
        (delta) => {
          deltas.push(delta);
          wake?.();
        },
        abort.signal,
      ),
    ).finally(() => {
      isFinished = true;
      wake?.();
    });
    // The failure is rethrown below, once the deltas that arrived before it are handed over.
    generation.catch(() => undefined);

    try {
      while (!isFinished || deltas.length > 0) {
        const delta = deltas.shift();

        if (delta !== undefined) {
          yield { type: 'text-delta', delta };
          continue;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      yield { type: 'done', response: await generation };
    } finally {
      // A reader that stops early must not leave the child writing to no one.
      abort.abort();
    }
  }

  private async runGeneration(
    request: AiGenerateRequest,
    onTextDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<AiGenerateResponse> {
    const { systemPrompt, prompt } = splitCliPrompt(request.messages);
    const output: CliOutput = { isRateLimited: false };

    // NOTE: 실행 파일에는 온도·시드·출력 상한 플래그가 없어 request.temperature 와 maxTokens 는
    // 전달되지 않는다.
    const run = await this.runner.run({
      command: this.command,
      args: [
        ...fixedArguments,
        '--model',
        this.model,
        '--system-prompt',
        systemPrompt,
        ...(request.reasoningEffort !== undefined && acceptsReasoningEffort(this.id, this.model)
          ? ['--effort', request.reasoningEffort]
          : []),
      ],
      stdin: prompt,
      timeoutMs: this.timeoutMs,
      withoutEnvironment: withheldEnvironment,
      onStdoutLine: (line) => {
        const event = parseJsonLine(line);

        if (event === undefined) {
          return;
        }

        const delta = readTextDelta(event);

        if (delta !== undefined) {
          onTextDelta?.(delta);
          return;
        }

        recordEvent(output, event);
      },
      ...(signal === undefined ? {} : { signal }),
    });

    this.assertStarted(run);

    if (run.failure === 'timeout') {
      throw new AiProviderError(
        'cli-timeout',
        this.id,
        `${this.displayName} 호출이 ${Math.round(this.timeoutMs / 1000)}초 안에 끝나지 않아 중단했습니다. 구독 한도에 닿았을 수 있습니다. 더 기다리려면 홈 설정의 providers.${this.id}.timeoutMs 를 늘리세요.`,
      );
    }

    if (run.failure === 'aborted') {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        generationFailedMessage(this.id, '중단됨'),
      );
    }

    const { result } = output;

    if (result === undefined || result.isError || run.exitCode !== 0) {
      throw this.failedRunError(run, output);
    }

    return aiGenerateResponseWithUsage({
      providerId: this.id,
      model: this.model,
      text: result.text,
      ...(result.usage === undefined ? {} : { usage: result.usage }),
      ...(result.stopReason === 'max_tokens' ? { isTruncated: true } : {}),
    });
  }

  private assertStarted(run: CliRunResult): void {
    if (run.failure === 'not-found') {
      throw new AiProviderError(
        'cli-not-found',
        this.id,
        `\`${this.command}\` 실행 파일을 찾을 수 없습니다. 설치돼 있는지 확인하세요. 설치돼 있는데도 못 찾는다면(창으로 띄운 앱은 터미널의 PATH 를 물려받지 않습니다) 홈 설정의 providers.${this.id}.command 에 전체 경로를 적으세요.`,
      );
    }
  }

  private notLoggedInError(): AiProviderError {
    return new AiProviderError(
      'cli-not-logged-in',
      this.id,
      `\`${this.command}\` 가 구독 로그인을 찾지 못했습니다. 터미널에서 \`${this.command}\` 를 실행해 로그인돼 있는지 확인하세요. 로그인돼 있는데도 이 오류가 나면 실행 파일의 기본 동작이 바뀌어(bare) 이 경로를 더는 쓸 수 없는 것입니다.`,
    );
  }

  // Each cause gets its own sentence: a person can act on «log in» or «wait until four», not on
  // «generation failed».
  private failedRunError(run: CliRunResult, output: CliOutput): AiProviderError {
    const { result } = output;
    const detail = result?.text.trim() || run.stderr.trim() || `종료 코드 ${String(run.exitCode)}`;

    if (/not logged in|\/login/i.test(detail)) {
      return this.notLoggedInError();
    }

    if (
      output.isRateLimited ||
      result?.apiErrorStatus === 429 ||
      /usage limit|rate limit|limit reached/i.test(detail)
    ) {
      return new AiProviderError(
        'cli-usage-limit',
        this.id,
        `구독 사용 한도에 닿아 중단했습니다.${formatResetTime(output.rateLimitResetsAt)} (${detail})`,
      );
    }

    return new AiProviderError(
      'generation-failed',
      this.id,
      generationFailedMessage(this.id, detail),
    );
  }
}

registerProviderFactory(providerId, (context) => {
  const config = context.configBridge.getProviderConfig(providerId);
  const cli = context.configBridge.getCliProviderConfig(providerId);
  const runner = context.clients.createCliRunner?.();

  return new ClaudeCodeProvider({
    model: context.modelOverride ?? config.model,
    ...cli,
    ...(runner === undefined ? {} : { runner }),
  });
});
