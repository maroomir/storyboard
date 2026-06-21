import { describe, expect, it } from "vitest"

import { AiProviderError } from "@/services/ai/AiProviderError"
import { ClaudeCodeProvider } from "@/services/ai/providers/ClaudeCodeProvider"
import { type CliRunInput, type CliRunResult, type CliRunner } from "@/services/ai/providers/cliRunner"

describe("ClaudeCodeProvider", () => {
  it("requires a command and a model", () => {
    expect(() => new ClaudeCodeProvider({ command: undefined, model: "sonnet" })).toThrow(AiProviderError)
    expect(() => new ClaudeCodeProvider({ command: "claude", model: undefined })).toThrow(AiProviderError)
  })

  it("checks connection by running --version", async () => {
    const calls: CliRunInput[] = []
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, onRun: (input) => calls.push(input) })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(calls[0]?.command).toBe("claude")
    expect(calls[0]?.args).toEqual(["--version"])
  })

  it("throws when --version exits non-zero", async () => {
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "not found" })
    })

    await expect(provider.checkConnection()).rejects.toMatchObject({
      code: "connection-failed",
      providerId: "claude-code"
    })
  })

  it("runs print mode with json output and passes the prompt over stdin", async () => {
    let captured: CliRunInput | undefined
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner =>
        createFakeRunner({
          exitCode: 0,
          stdout: JSON.stringify({
            result: "초안 텍스트",
            total_cost_usd: 0.0123,
            usage: { input_tokens: 120, output_tokens: 340 }
          }),
          onRun: (input) => {
            captured = input
          }
        })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "지시문" },
        { role: "user", content: "본문" }
      ]
    })

    expect(captured?.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "sonnet",
      "--append-system-prompt",
      "지시문"
    ])
    expect(captured?.stdin).toBe("본문")
    expect(response).toEqual({
      providerId: "claude-code",
      model: "sonnet",
      text: "초안 텍스트",
      usage: { inputTokens: 120, outputTokens: 340, cacheReadInputTokens: undefined, cacheCreationInputTokens: undefined },
      costUsd: 0.0123
    })
  })

  it("omits the system flag when no system message is present", async () => {
    let captured: CliRunInput | undefined
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner =>
        createFakeRunner({
          exitCode: 0,
          stdout: JSON.stringify({ result: "ok" }),
          onRun: (input) => {
            captured = input
          }
        })
    })

    await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(captured?.args).not.toContain("--append-system-prompt")
  })

  it("maps a non-zero generate exit code to a generation error", async () => {
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 2, stderr: "boom" })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    ).rejects.toMatchObject({ code: "generation-failed", providerId: "claude-code" })
  })

  it("treats an is_error result as a generation failure", async () => {
    const provider = new ClaudeCodeProvider({
      command: "claude",
      model: "sonnet",
      createRunner: (): CliRunner =>
        createFakeRunner({ exitCode: 0, stdout: JSON.stringify({ is_error: true, result: "거부됨" }) })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    ).rejects.toMatchObject({ code: "generation-failed", providerId: "claude-code" })
  })
})

interface FakeRunnerOptions {
  readonly exitCode: number | null
  readonly stdout?: string
  readonly stderr?: string
  readonly onRun?: (input: CliRunInput) => void
}

function createFakeRunner(options: FakeRunnerOptions): CliRunner {
  return async (input: CliRunInput): Promise<CliRunResult> => {
    options.onRun?.(input)
    return {
      stdout: options.stdout ?? "",
      stderr: options.stderr ?? "",
      exitCode: options.exitCode
    }
  }
}
