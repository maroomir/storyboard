import os from "node:os"

import { AiProviderError } from "../AiProviderError"
import { aiGenerateResponseWithUsage } from "../cost"
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

export interface CodexProviderOptions {
  readonly command: string | undefined
  readonly model: string | undefined
  readonly createRunner?: () => CliRunner
}

export class CodexProvider implements AiProvider {
  public readonly id: AiProviderId = "codex"
  public readonly displayName = "Codex (CLI)"
  private readonly command: string
  private readonly model: string
  private readonly run: CliRunner

  public constructor(options: CodexProviderOptions) {
    const command = options.command?.trim()
    const model = options.model?.trim()

    if (!command) {
      throw new AiProviderError("missing-model", this.id, "Codex 실행 명령이 설정되어 있지 않습니다.")
    }

    if (!model) {
      throw new AiProviderError("missing-model", this.id, "Codex 모델이 설정되어 있지 않습니다.")
    }

    this.command = command
    this.model = model
    this.run = options.createRunner?.() ?? createDefaultCliRunner()
  }

  public async checkConnection(): Promise<boolean> {
    try {
      // NOTE: `codex login status`는 로그인 시 exit 0과 "Logged in using ..." 텍스트를 출력한다
      // (codex-cli 0.138.0 확인). 로그아웃 시 비정상 종료 여부는 로그인된 환경에서 검증하지 못했다.
      const result = await this.run({
        command: this.command,
        args: ["login", "status"],
        timeoutMs: connectionTimeoutMs
      })
      if (result.exitCode !== 0) {
        throw new AiProviderError(
          "connection-failed",
          this.id,
          "Codex CLI 인증을 확인하지 못했습니다. `codex login`으로 로그인하세요.",
          result.stderr
        )
      }

      return true
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error
      }

      throw new AiProviderError("connection-failed", this.id, "Codex CLI 연결 확인에 실패했습니다.", error)
    }
  }

  public async generate(request: AiGenerateRequest): Promise<AiGenerateResponse> {
    const { systemPrompt, userPrompt } = splitCliPrompt(request.messages)
    const prompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt
    // NOTE: codex CLI는 temperature를 노출하지 않아 request.temperature와
    // request.maxTokens는 적용되지 않는다.
    // NOTE: read-only 샌드박스로 실행해 Codex가 파일을 수정하지 못하게 한다.
    // NOTE: --json으로 stdout에 JSONL 이벤트를 받아 최종 메시지와 토큰 사용량을 파싱한다.
    const args = ["exec", "--model", this.model, "--sandbox", "read-only", "--skip-git-repo-check", "--json"]

    let result
    try {
      result = await this.run({
        command: this.command,
        args,
        stdin: prompt,
        cwd: os.tmpdir(),
        timeoutMs: generateTimeoutMs
      })
    } catch (error) {
      throw new AiProviderError("generation-failed", this.id, "Codex CLI 실행에 실패했습니다.", error)
    }

    if (result.exitCode !== 0) {
      throw new AiProviderError(
        "generation-failed",
        this.id,
        `Codex CLI가 비정상 종료했습니다 (exit ${result.exitCode ?? "unknown"}).`,
        result.stderr
      )
    }

    const parsed = parseCodexJsonl(result.stdout)
    // NOTE: --json을 인식하지 못하는 CLI/버전이면 평문 stdout로 폴백해 throw 없이 동작시킨다.
    const text = parsed.text ?? result.stdout.trim()

    return aiGenerateResponseWithUsage({
      providerId: this.id,
      model: this.model,
      text,
      ...(parsed.usage ? { usage: parsed.usage } : {})
    })
  }
}

interface CodexJsonlParseResult {
  readonly text?: string
  readonly usage?: AiUsage
}

interface CodexTurnUsage {
  readonly input_tokens?: number
  readonly cached_input_tokens?: number
  readonly output_tokens?: number
  readonly reasoning_output_tokens?: number
}

function parseCodexJsonl(stdout: string): CodexJsonlParseResult {
  let text: string | undefined
  let usage: AiUsage | undefined

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (!isRecord(event)) {
      continue
    }

    if (event.type === "item.completed" && isRecord(event.item) && event.item.type === "agent_message") {
      const message = event.item.text
      if (typeof message === "string") {
        text = message
      }
    }

    if (event.type === "turn.completed" && isRecord(event.usage)) {
      usage = usageFromCodexTurn(event.usage as CodexTurnUsage)
    }
  }

  return {
    ...(text !== undefined ? { text } : {}),
    ...(usage ? { usage } : {})
  }
}

function usageFromCodexTurn(turnUsage: CodexTurnUsage): AiUsage {
  // NOTE: codex의 output_tokens는 reasoning_output_tokens를 이미 포함하므로 더하면 이중 계산이 된다.
  return {
    inputTokens: turnUsage.input_tokens ?? 0,
    outputTokens: turnUsage.output_tokens ?? 0,
    cacheReadInputTokens: turnUsage.cached_input_tokens
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
