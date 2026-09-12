import { spawn } from "node:child_process"
import os from "node:os"

import type { AiGenerateRequest, AiGenerateResponse, AiProvider, AiProviderId } from "@storyboard/story-ai"

// NOTE: 진단 전용. 구독 Claude Code CLI를 개인 계정으로 부르는 경로이며, 제품 프로바이더 카탈로그에는
// 없다(0.9.2에서 제외). 이 경로로 잰 값은 API 모델과 같은 가중치라는 보증이 없으므로
// modelProfiles.params.json 에 기록하지 않는다 — 파이프라인 손잡이 탐색용 숫자로만 쓴다.
// 구독 소진분은 청구액이 아니므로 costUsd 를 채우지 않는다(사용량 요약은 토큰만 보여준다).
const claudeCodeProviderId = "claude-code" as AiProviderId

interface ClaudeCodeJsonResult {
  readonly result?: string
  readonly is_error?: boolean
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_creation_input_tokens?: number
    readonly cache_read_input_tokens?: number
  }
}

export function createClaudeCodeHarnessProvider(model: string, timeoutMs: number): AiProvider {
  return {
    id: claudeCodeProviderId,
    displayName: "Claude Code (harness)",
    checkConnection: async (): Promise<boolean> => true,
    generate: async (request: AiGenerateRequest): Promise<AiGenerateResponse> => {
      const systemPrompt = joinMessages(request, "system")
      const userPrompt = joinMessages(request, "user")

      // NOTE: 기본 claude 는 도구를 쓰는 코딩 에이전트다. `--tools ''` 로 도구를 끄고
      // `--append-system-prompt` 대신 `--system-prompt` 로 페르소나를 통째로 갈아끼워야
      // "I'll write the scene..." 같은 에이전트 말투가 초안에 섞이지 않는다.
      const args = ["-p", "--output-format", "json", "--model", model, "--tools", ""]
      if (systemPrompt.length > 0) {
        args.push("--system-prompt", systemPrompt)
      }

      const stdout = await runClaudeCode(args, userPrompt, timeoutMs)
      const parsed = parseResult(stdout)
      if (parsed.is_error === true) {
        throw new Error(`claude -p 가 오류 결과를 반환했습니다: ${parsed.result ?? ""}`)
      }

      return {
        providerId: claudeCodeProviderId,
        model,
        text: parsed.result ?? "",
        usage: {
          // NOTE: claude -p 는 자체 시스템 맥락을 캐시로 올리므로 input_tokens 는 2 같은 숫자만
          // 나온다. 실제로 읽힌 양은 캐시 칸에 있어 함께 세지 않으면 집계가 거짓이 된다.
          inputTokens: parsed.usage?.input_tokens ?? 0,
          outputTokens: parsed.usage?.output_tokens ?? 0,
          cacheCreationInputTokens: parsed.usage?.cache_creation_input_tokens,
          cacheReadInputTokens: parsed.usage?.cache_read_input_tokens
        }
      }
    }
  }
}

function joinMessages(request: AiGenerateRequest, role: "system" | "user"): string {
  return request.messages
    .filter((message) => (role === "system" ? message.role === "system" : message.role !== "system"))
    .map((message) => message.content)
    .join("\n\n")
}

function parseResult(stdout: string): ClaudeCodeJsonResult {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed) as ClaudeCodeJsonResult
  } catch {
    return { result: trimmed }
  }
}

function runClaudeCode(args: readonly string[], stdin: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // SECURITY: shell:false 와 인자 배열로 실행해 셸 보간을 막고, 프롬프트는 stdin 으로만 넘긴다.
    // 임시 디렉터리에서 돌려 CLI 의 파일 접근이 작업공간을 건드리지 않게 한다.
    const child = spawn("claude", [...args], { shell: false, cwd: os.tmpdir() })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`claude -p 가 ${timeoutMs}ms 안에 끝나지 않았습니다.`))
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
    child.stdin.on("error", () => {})
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString("utf8"))
        return
      }
      reject(new Error(`claude -p 가 비정상 종료했습니다 (exit ${code ?? "unknown"}): ${Buffer.concat(stderrChunks).toString("utf8").trim()}`))
    })

    child.stdin.write(stdin)
    child.stdin.end()
  })
}
