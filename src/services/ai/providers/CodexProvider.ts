import os from "node:os"

import { AiProviderError } from "../AiProviderError"
import {
  type AiGenerateRequest,
  type AiGenerateResponse,
  type AiProvider,
  type AiProviderId
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
      // NOTE: codex의 인증 상태 확인 명령. 바이너리 존재와 로그인 여부를 함께 본다.
      // 이 환경엔 codex가 없어 명령 형태는 문서 기준이며 실제 출력은 미검증이다.
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
    // NOTE: read-only 샌드박스로 실행해 Codex가 파일을 수정하지 못하게 한다.
    const args = ["exec", "--model", this.model, "--sandbox", "read-only", "--skip-git-repo-check"]

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

    return {
      providerId: this.id,
      model: this.model,
      text: result.stdout.trim()
    }
  }
}
