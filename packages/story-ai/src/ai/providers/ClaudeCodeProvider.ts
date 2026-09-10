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
import {
  cliProviderDefaults,
  connectionCheckFailedMessage,
  getProviderDisplayName,
  missingModelMessage,
} from '#ai/contracts/providerCatalog';


export interface ClaudeCodeProviderOptions {
  readonly command: string | undefined;
  readonly model: string | undefined;
  readonly generateTimeoutMs?: number;
  readonly createRunner?: () => CliRunner;
}

interface ClaudeCodeJsonResult {
  readonly result?: string;
  readonly is_error?: boolean;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export class ClaudeCodeProvider implements AiProvider {
  public readonly id: AiProviderId = 'claude-code';
  public readonly displayName = getProviderDisplayName('claude-code');
  private readonly command: string;
  private readonly model: string;
  private readonly generateTimeoutMs: number;
  private readonly run: CliRunner;

  public constructor(options: ClaudeCodeProviderOptions) {
    const command = options.command?.trim();
    const model = options.model?.trim();

    if (!command) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        'Claude Code 실행 명령이 설정되어 있지 않습니다.',
      );
    }

    if (!model) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        missingModelMessage(this.id),
      );
    }

    this.command = command;
    this.model = model;
    this.generateTimeoutMs = options.generateTimeoutMs ?? cliProviderDefaults.generateTimeoutMs;
    this.run = options.createRunner?.() ?? createDefaultCliRunner();
  }

  public async checkConnection(): Promise<boolean> {
    try {
      // NOTE: `claude auth status --json`은 로그인 시 `{ "loggedIn": true }`를 출력한다(claude 2.1.185 확인).
      // 로그아웃 시 JSON 형태는 로그인된 환경에서 검증하지 못했다.
      const result = await this.run({
        command: this.command,
        args: ['auth', 'status', '--json'],
        timeoutMs: cliProviderDefaults.connectionCheckTimeoutMs,
      });
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          'connection-failed',
          this.id,
          'Claude Code CLI를 실행하지 못했습니다.',
          result.stderr,
        );
      }

      if (!isLoggedIn(result.stdout)) {
        throw new AiProviderError(
          'connection-failed',
          this.id,
          'Claude Code에 로그인되어 있지 않습니다. `claude auth login`으로 로그인하세요.',
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
          `Claude Code 실행 명령 \`${this.command}\`을 찾을 수 없습니다.`,
          error,
          { connectionReason: 'not-installed' },
        );
      }

      throw new AiProviderError(
        'connection-failed',
        this.id,
        connectionCheckFailedMessage(this.id),
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { systemPrompt, userPrompt } = splitCliPrompt(request.messages);
    // NOTE: claude CLI는 temperature·출력 토큰 상한 플래그를 노출하지 않아
    // request.temperature와 request.maxTokens는 적용되지 않는다.
    // NOTE: 기본 claude는 도구를 쓰는 코딩 에이전트다. `--tools ''`로 도구를 끄고
    //       `--append-system-prompt` 대신 `--system-prompt`로 그 페르소나를 통째로 갈아끼워야
    //       "I'll write the scene..." 같은 에이전트 말투가 초안에 섞이지 않는다.
    //       `--bare`는 키체인을 건너뛰어 로그인 세션을 못 찾으므로 쓰지 않는다.
    const args = ['-p', '--output-format', 'json', '--model', this.model, '--tools', ''];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    let result;
    try {
      // NOTE: 임시 디렉터리에서 실행해 CLI의 파일 접근이 사용자 작업공간을 건드리지 않게 한다.
      result = await this.run({
        command: this.command,
        args,
        stdin: userPrompt,
        cwd: os.tmpdir(),
        timeoutMs: this.generateTimeoutMs,
      });
    } catch (error) {
      throw new AiProviderError(
        'generation-failed',
        this.id,
        'Claude Code CLI 실행에 실패했습니다.',
        error,
      );
    }

    if (result.exitCode !== 0) {
      const failureMessage = extractClaudeCodeFailureMessage(result);
      throw new AiProviderError(
        'generation-failed',
        this.id,
        `Claude Code CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? 'unknown'})` +
          `${failureMessage ? `: ${failureMessage}` : '.'}`,
        failureMessage ?? result.stderr,
      );
    }

    const parsed = parseClaudeCodeResult(result.stdout);
    if (parsed.is_error) {
      const failureMessage = parsed.result ? truncateFailureMessage(parsed.result.trim()) : undefined;
      throw new AiProviderError(
        'generation-failed',
        this.id,
        `Claude Code CLI가 오류 결과를 반환했습니다${failureMessage ? `: ${failureMessage}` : '.'}`,
        parsed.result,
      );
    }

    const usage = usageFromClaudeCode(parsed);
    return {
      providerId: this.id,
      model: this.model,
      text: parsed.result ?? '',
      ...(usage ? { usage } : {}),
      ...(parsed.total_cost_usd !== undefined ? { costUsd: parsed.total_cost_usd } : {}),
    };
  }
}

function isLoggedIn(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout.trim()) as { readonly loggedIn?: boolean };
    return parsed.loggedIn === true;
  } catch {
    return false;
  }
}

// 실패 사유를 메시지 본문에 넣는다. cause에만 두면 배치 실행 로그에는 exit 코드만 남아
// 한도 초과인지 인증 문제인지 구분할 수 없다.
function extractClaudeCodeFailureMessage(result: CliRunResult): string | undefined {
  const parsed = parseClaudeCodeResult(result.stdout);
  const resultMessage = parsed.result?.trim();
  if (resultMessage) {
    return truncateFailureMessage(resultMessage);
  }

  const stderrMessage = result.stderr.trim();
  return stderrMessage.length > 0 ? truncateFailureMessage(stderrMessage) : undefined;
}

function parseClaudeCodeResult(stdout: string): ClaudeCodeJsonResult {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ClaudeCodeJsonResult;
  } catch {
    return { result: trimmed };
  }
}

function usageFromClaudeCode(parsed: ClaudeCodeJsonResult): AiUsage | undefined {
  const usage = parsed.usage;
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
