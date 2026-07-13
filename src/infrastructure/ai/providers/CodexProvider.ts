import os from 'node:os';

import { AiProviderError } from '../../../shared/aiProviderError';
import { aiGenerateResponseWithUsage } from '../cost';
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
} from '../../../shared/aiTypes';
import {
  type CliRunner,
  type CliRunResult,
  createDefaultCliRunner,
  isCommandNotFound,
  splitCliPrompt,
} from './cliRunner';

const connectionTimeoutMs = 15_000;
const defaultGenerateTimeoutMs = 600_000;

export interface CodexProviderOptions {
  readonly command: string | undefined;
  readonly model: string | undefined;
  readonly generateTimeoutMs?: number;
  readonly createRunner?: () => CliRunner;
}

export class CodexProvider implements AiProvider {
  public readonly id: AiProviderId = 'codex';
  public readonly displayName = 'Codex (CLI)';
  private readonly command: string;
  private readonly model: string;
  private readonly generateTimeoutMs: number;
  private readonly run: CliRunner;

  public constructor(options: CodexProviderOptions) {
    const command = options.command?.trim();
    const model = options.model?.trim();

    if (!command) {
      throw new AiProviderError(
        'missing-model',
        this.id,
        'Codex 실행 명령이 설정되어 있지 않습니다.',
      );
    }

    if (!model) {
      throw new AiProviderError('missing-model', this.id, 'Codex 모델이 설정되어 있지 않습니다.');
    }

    this.command = command;
    this.model = model;
    this.generateTimeoutMs = options.generateTimeoutMs ?? defaultGenerateTimeoutMs;
    this.run = options.createRunner?.() ?? createDefaultCliRunner();
  }

  public async checkConnection(): Promise<boolean> {
    try {
      // NOTE: `codex login status`는 로그인 시 exit 0과 "Logged in using ..." 텍스트를 출력한다
      // (codex-cli 0.138.0 확인). 로그아웃 시 비정상 종료 여부는 로그인된 환경에서 검증하지 못했다.
      const result = await this.run({
        command: this.command,
        args: ['login', 'status'],
        timeoutMs: connectionTimeoutMs,
      });
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          'connection-failed',
          this.id,
          'Codex CLI 인증을 확인하지 못했습니다. `codex login`으로 로그인하세요.',
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
          `Codex 실행 명령 \`${this.command}\`을 찾을 수 없습니다.`,
          error,
          { connectionReason: 'not-installed' },
        );
      }

      throw new AiProviderError(
        'connection-failed',
        this.id,
        'Codex CLI 연결 확인에 실패했습니다.',
        error,
      );
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { systemPrompt, userPrompt } = splitCliPrompt(request.messages);
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
    // NOTE: codex CLI는 temperature를 노출하지 않아 request.temperature와
    // request.maxTokens는 적용되지 않는다.
    // NOTE: read-only 샌드박스로 실행해 Codex가 파일을 수정하지 못하게 한다.
    // NOTE: --json으로 stdout에 JSONL 이벤트를 받아 최종 메시지와 토큰 사용량을 파싱한다.
    const args = [
      'exec',
      '--model',
      this.model,
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--json',
    ];

    let result;
    try {
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
        'Codex CLI 실행에 실패했습니다.',
        error,
      );
    }

    if (result.exitCode !== 0) {
      const failureMessage = extractCodexFailureMessage(result);
      const message = failureMessage
        ? `Codex CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? 'unknown'}): ${failureMessage}`
        : `Codex CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? 'unknown'}).`;

      throw new AiProviderError(
        'generation-failed',
        this.id,
        message,
        failureMessage ?? result.stderr,
      );
    }

    const parsed = parseCodexJsonl(result.stdout);
    // NOTE: JSONL을 파싱했으나 agent_message가 없으면 원시 JSONL을 답변으로 내보내지 않는다.
    //       --json을 인식하지 못해 평문만 출력하는 CLI/버전일 때만 stdout로 폴백한다.
    const text = parsed.text ?? (parsed.sawJsonlEvent ? '' : result.stdout.trim());

    return aiGenerateResponseWithUsage({
      providerId: this.id,
      model: this.model,
      text,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    });
  }
}

interface CodexJsonlParseResult {
  readonly text?: string;
  readonly usage?: AiUsage;
  readonly sawJsonlEvent: boolean;
}

interface CodexTurnUsage {
  readonly input_tokens?: number;
  readonly cached_input_tokens?: number;
  readonly output_tokens?: number;
  readonly reasoning_output_tokens?: number;
}

function* iterateCodexJsonlEvents(stdout: string): Generator<Record<string, unknown>> {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(event)) {
      continue;
    }

    yield event;
  }
}

function agentMessageFromCodexEvent(event: Record<string, unknown>): string | undefined {
  if (
    event.type !== 'item.completed' ||
    !isRecord(event.item) ||
    event.item.type !== 'agent_message'
  ) {
    return undefined;
  }

  return typeof event.item.text === 'string' ? event.item.text : undefined;
}

function parseCodexJsonl(stdout: string): CodexJsonlParseResult {
  let text: string | undefined;
  let usage: AiUsage | undefined;
  let sawJsonlEvent = false;

  for (const event of iterateCodexJsonlEvents(stdout)) {
    sawJsonlEvent = true;

    const message = agentMessageFromCodexEvent(event);
    if (message !== undefined) {
      text = message;
    }

    if (event.type === 'turn.completed' && isRecord(event.usage)) {
      // NOTE: 토큰이 빈 후속 turn.completed가 앞선 usage를 0으로 덮어쓰지 않도록 값이 있을 때만 갱신한다.
      const turnUsage = usageFromCodexTurn(event.usage as CodexTurnUsage);
      if (turnUsage) {
        usage = turnUsage;
      }
    }
  }

  return {
    ...(text !== undefined ? { text } : {}),
    ...(usage ? { usage } : {}),
    sawJsonlEvent,
  };
}

function usageFromCodexTurn(turnUsage: CodexTurnUsage): AiUsage | undefined {
  if (turnUsage.input_tokens === undefined && turnUsage.output_tokens === undefined) {
    return undefined;
  }

  // NOTE: codex의 output_tokens는 reasoning_output_tokens를 이미 포함하므로 더하면 이중 계산이 된다.
  return {
    inputTokens: turnUsage.input_tokens ?? 0,
    outputTokens: turnUsage.output_tokens ?? 0,
    cacheReadInputTokens: turnUsage.cached_input_tokens,
  };
}

function extractCodexFailureMessage(result: CliRunResult): string | undefined {
  const stdoutMessage = extractCodexJsonlFailureMessage(result.stdout);
  if (stdoutMessage) {
    return stdoutMessage;
  }

  const stderrMessage = result.stderr.trim();
  return stderrMessage.length > 0 ? truncateFailureMessage(stderrMessage) : undefined;
}

function topLevelErrorFromCodexEvent(event: Record<string, unknown>): string | undefined {
  return event.type === 'error' && typeof event.message === 'string' ? event.message : undefined;
}

function turnErrorFromCodexEvent(event: Record<string, unknown>): string | undefined {
  if (
    event.type !== 'turn.failed' ||
    !isRecord(event.error) ||
    typeof event.error.message !== 'string'
  ) {
    return undefined;
  }

  return event.error.message;
}

function itemErrorFromCodexEvent(event: Record<string, unknown>): string | undefined {
  if (
    event.type !== 'item.completed' ||
    !isRecord(event.item) ||
    event.item.type !== 'error' ||
    typeof event.item.message !== 'string'
  ) {
    return undefined;
  }

  return event.item.message;
}

function extractCodexJsonlFailureMessage(stdout: string): string | undefined {
  let itemError: string | undefined;
  let turnError: string | undefined;
  let topLevelError: string | undefined;

  for (const event of iterateCodexJsonlEvents(stdout)) {
    const topLevel = topLevelErrorFromCodexEvent(event);
    if (topLevel !== undefined) {
      topLevelError = normalizeCodexErrorMessage(topLevel);
      continue;
    }

    const turn = turnErrorFromCodexEvent(event);
    if (turn !== undefined) {
      turnError = normalizeCodexErrorMessage(turn);
      continue;
    }

    const item = itemErrorFromCodexEvent(event);
    if (item !== undefined) {
      itemError = normalizeCodexErrorMessage(item);
    }
  }

  return topLevelError || turnError || itemError;
}

function normalizeCodexErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return truncateFailureMessage(trimmed);
  }

  if (isRecord(parsed)) {
    if (isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return truncateFailureMessage(parsed.error.message);
    }

    if (typeof parsed.message === 'string') {
      return truncateFailureMessage(parsed.message);
    }
  }

  return truncateFailureMessage(trimmed);
}

function truncateFailureMessage(message: string): string {
  const maxLength = 1_000;
  return message.length > maxLength ? `${message.slice(0, maxLength - 3)}...` : message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
