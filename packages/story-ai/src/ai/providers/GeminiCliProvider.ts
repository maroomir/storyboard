import os from 'node:os';

import { AiProviderError } from '#ai/contracts/aiProviderError';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
} from '#ai/contracts/aiTypes';
import {
  type CliRunner,
  type CliRunResult,
  createDefaultCliRunner,
  isCommandNotFound,
  splitCliPrompt,
  truncateFailureMessage,
} from './cliRunner';
import { cliProviderDefaults, getProviderDisplayName } from '#ai/contracts/providerCatalog';

// gemini-cli exits 41 (FatalAuthenticationError) when no cached login or key env var is usable;
// a cached login the service no longer accepts exits 55 with "Error authenticating: …" instead
// (gemini-cli 0.58.0, IneligibleTierError), so the stderr prefix is checked too.
const authenticationExitCode = 41;
const authenticationStderrPattern = /error authenticating/i;

export interface GeminiCliProviderOptions {
  readonly command: string | undefined;
  readonly model: string | undefined;
  readonly generateTimeoutMs?: number;
  readonly createRunner?: () => CliRunner;
}

interface GeminiCliModelTokens {
  readonly prompt?: number;
  readonly candidates?: number;
  readonly thoughts?: number;
  readonly cached?: number;
}

interface GeminiCliJsonResult {
  readonly response?: string;
  readonly stats?: {
    readonly models?: Readonly<Record<string, { readonly tokens?: GeminiCliModelTokens }>>;
  };
  readonly error?: {
    readonly type?: string;
    readonly message?: string;
    readonly code?: number | string;
  };
}

export class GeminiCliProvider implements AiProvider {
  public readonly id: AiProviderId = 'gemini-cli';
  public readonly displayName = getProviderDisplayName('gemini-cli');
  private readonly command: string;
  private readonly model: string;
  private readonly generateTimeoutMs: number;
  private readonly run: CliRunner;

  public constructor(options: GeminiCliProviderOptions) {
    const command = options.command?.trim();
    const model = options.model?.trim();

    if (!command) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        'Gemini CLI 실행 명령이 설정되어 있지 않습니다.',
      );
    }

    if (!model) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        'Gemini CLI 모델이 설정되어 있지 않습니다.',
      );
    }

    this.command = command;
    this.model = model;
    this.generateTimeoutMs = options.generateTimeoutMs ?? cliProviderDefaults.generateTimeoutMs;
    this.run = options.createRunner?.() ?? createDefaultCliRunner();
  }

  public async checkConnection(): Promise<boolean> {
    try {
      // NOTE: gemini-cli에는 로그인 상태만 묻는 부명령이 없어 설치 여부(`--version`)만 확인한다.
      // 인증 실패는 첫 생성에서 exit 41로 드러나며 아래 generate가 로그인 안내로 바꿔 보고한다.
      const result = await this.run({
        command: this.command,
        args: ['--version'],
        timeoutMs: cliProviderDefaults.connectionCheckTimeoutMs,
      });
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          'connection-failed',
          this.id,
          'Gemini CLI를 실행하지 못했습니다.',
          result.stderr,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }

      if (isCommandNotFound(error)) {
        throw new AiProviderError(
          'connection-failed',
          this.id,
          `Gemini CLI 실행 명령 \`${this.command}\`을 찾을 수 없습니다.`,
          error,
          { connectionReason: 'not-installed' },
        );
      }

      throw new AiProviderError(
        'connection-failed',
        this.id,
        'Gemini CLI 연결 확인에 실패했습니다.',
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { systemPrompt, userPrompt } = splitCliPrompt(request.messages);
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
    // NOTE: gemini CLI는 temperature·출력 토큰 상한 플래그를 노출하지 않아 request.temperature와
    // request.maxTokens는 적용되지 않는다. 프롬프트는 stdin으로 주고, TTY가 아니면 CLI가 스스로
    // 헤드리스로 돌기 때문에 -p 는 쓰지 않는다.
    const args = ['--model', this.model, '--output-format', 'json'];

    let result;
    try {
      // NOTE: 임시 디렉터리에서 실행해 CLI의 파일 접근이 사용자 작업공간을 건드리지 않게 한다.
      result = await this.run({
        command: this.command,
        args,
        stdin: prompt,
        cwd: os.tmpdir(),
        timeoutMs: this.generateTimeoutMs,
      });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        'Gemini CLI 실행에 실패했습니다.',
        error,
      );
    }

    const parsed = parseGeminiCliResult(result.stdout);

    if (isAuthenticationFailure(result)) {
      const detail = extractGeminiCliFailureMessage(parsed, result);
      throw new AiProviderError(
        'generation-failed',
        this.id,
        `Gemini CLI 인증에 실패했습니다. \`gemini\` 를 한 번 실행해 로그인하거나 GEMINI_API_KEY 를 설정하세요.${detail ? ` (${detail})` : ''}`,
        detail ?? result.stderr,
      );
    }

    if (result.exitCode !== 0 || parsed.error) {
      const failureMessage = extractGeminiCliFailureMessage(parsed, result);
      throw new AiProviderError(
        'generation-failed',
        this.id,
        failureMessage
          ? `Gemini CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? 'unknown'}): ${failureMessage}`
          : `Gemini CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? 'unknown'}).`,
        failureMessage ?? result.stderr,
      );
    }

    const usage = usageFromGeminiCli(parsed);
    return {
      providerId: this.id,
      model: this.model,
      text: parsed.response ?? '',
      ...(usage ? { usage } : {}),
    };
  }
}

// NOTE: gemini-cli writes warnings to stderr during a perfectly good run, so the stderr phrasing
// only classifies a run that already failed — never one that exited 0 with an answer.
function isAuthenticationFailure(result: CliRunResult): boolean {
  return (
    result.exitCode !== 0 &&
    (result.exitCode === authenticationExitCode || authenticationStderrPattern.test(result.stderr))
  );
}

function parseGeminiCliResult(stdout: string): GeminiCliJsonResult {
  const trimmed = stdout.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as GeminiCliJsonResult)
      : { response: trimmed };
  } catch {
    // NOTE: --output-format 을 모르는 구버전은 평문만 낸다. 그때만 stdout 을 답변으로 쓴다.
    return { response: trimmed };
  }
}

// Stats are keyed by the model that actually answered — the CLI can quietly fall back from Pro to
// Flash mid-session — so every model's tokens are summed rather than looked up by the requested id.
function usageFromGeminiCli(parsed: GeminiCliJsonResult): AiUsage | undefined {
  const models = Object.values(parsed.stats?.models ?? {});
  if (models.length === 0) {
    return undefined;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  for (const { tokens } of models) {
    inputTokens += tokens?.prompt ?? 0;
    // Thinking tokens are billed as output, so they belong to the output count.
    outputTokens += (tokens?.candidates ?? 0) + (tokens?.thoughts ?? 0);
    cacheReadInputTokens += tokens?.cached ?? 0;
  }

  return {
    inputTokens,
    outputTokens,
    ...(cacheReadInputTokens > 0 ? { cacheReadInputTokens } : {}),
  };
}

function extractGeminiCliFailureMessage(
  parsed: GeminiCliJsonResult,
  result: CliRunResult,
): string | undefined {
  const jsonMessage = parsed.error?.message?.trim();
  if (jsonMessage) {
    return truncateFailureMessage(jsonMessage);
  }

  const stderrMessage = result.stderr.trim();
  return stderrMessage.length > 0 ? truncateFailureMessage(stderrMessage) : undefined;
}
