import os from "node:os"

import { AiProviderError } from "../AiProviderError"
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId,
  type AiUsage
} from "../types"
import { type CliRunner, createDefaultCliRunner, splitCliPrompt } from "./cliRunner"

const connectionTimeoutMs = 15_000
const generateTimeoutMs = 180_000

export interface ClaudeCodeProviderOptions {
  readonly command: string | undefined
  readonly model: string | undefined
  readonly createRunner?: () => CliRunner
}

interface ClaudeCodeJsonResult {
  readonly result?: string
  readonly is_error?: boolean
  readonly total_cost_usd?: number
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

export class ClaudeCodeProvider implements AiProvider {
  public readonly id: AiProviderId = "claude-code"
  public readonly displayName = "Claude Code (CLI)"
  private readonly command: string
  private readonly model: string
  private readonly run: CliRunner

  public constructor(options: ClaudeCodeProviderOptions) {
    const command = options.command?.trim()
    const model = options.model?.trim()

    if (!command) {
      throw new AiProviderError("missing-model", this.id, "Claude Code 실행 명령이 설정되어 있지 않습니다.")
    }

    if (!model) {
      throw new AiProviderError("missing-model", this.id, "Claude Code 모델이 설정되어 있지 않습니다.")
    }

    this.command = command
    this.model = model
    this.run = options.createRunner?.() ?? createDefaultCliRunner()
  }

  public async checkConnection(): Promise<boolean> {
    try {
      // NOTE: auth status는 토큰을 쓰지 않고 바이너리 존재와 구독 로그인 여부를 함께 확인한다.
      const result = await this.run({
        command: this.command,
        args: ["auth", "status", "--json"],
        timeoutMs: connectionTimeoutMs
      })
      if (result.exitCode !== 0) {
        throw new AiProviderError("connection-failed", this.id, "Claude Code CLI를 실행하지 못했습니다.", result.stderr)
      }

      if (!isLoggedIn(result.stdout)) {
        throw new AiProviderError(
          "connection-failed",
          this.id,
          "Claude Code에 로그인되어 있지 않습니다. `claude auth login`으로 로그인하세요."
        )
      }

      return true
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error
      }

      throw new AiProviderError("connection-failed", this.id, "Claude Code CLI 연결 확인에 실패했습니다.", error)
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { systemPrompt, userPrompt } = splitCliPrompt(request.messages)
    // NOTE: claude CLI는 temperature·출력 토큰 상한 플래그를 노출하지 않아
    // request.temperature와 request.maxTokens는 적용되지 않는다.
    const args = ["-p", "--output-format", "json", "--model", this.model]
    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt)
    }

    let result
    try {
      // NOTE: 임시 디렉터리에서 실행해 CLI의 파일 접근이 사용자 작업공간을 건드리지 않게 한다.
      result = await this.run({
        command: this.command,
        args,
        stdin: userPrompt,
        cwd: os.tmpdir(),
        timeoutMs: generateTimeoutMs
      })
    } catch (error) {
      throw new AiProviderError("generation-failed", this.id, "Claude Code CLI 실행에 실패했습니다.", error)
    }

    if (result.exitCode !== 0) {
      throw new AiProviderError(
        "generation-failed",
        this.id,
        `Claude Code CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? "unknown"}).`,
        result.stderr
      )
    }

    const parsed = parseClaudeCodeResult(result.stdout)
    if (parsed.is_error) {
      throw new AiProviderError("generation-failed", this.id, "Claude Code CLI가 오류 결과를 반환했습니다.", parsed.result)
    }

    const usage = usageFromClaudeCode(parsed)
    return {
      providerId: this.id,
      model: this.model,
      text: parsed.result ?? "",
      ...(usage ? { usage } : {}),
      ...(parsed.total_cost_usd !== undefined ? { costUsd: parsed.total_cost_usd } : {})
    }
  }
}

function isLoggedIn(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout.trim()) as { readonly loggedIn?: boolean }
    return parsed.loggedIn === true
  } catch {
    return false
  }
}

function parseClaudeCodeResult(stdout: string): ClaudeCodeJsonResult {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed) as ClaudeCodeJsonResult
  } catch {
    return { result: trimmed }
  }
}

function usageFromClaudeCode(parsed: ClaudeCodeJsonResult): AiUsage | undefined {
  const usage = parsed.usage
  if (!usage) {
    return undefined
  }

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens
  }
}
