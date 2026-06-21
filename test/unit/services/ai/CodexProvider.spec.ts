import { describe, expect, it } from "vitest"

import { AiProviderError } from "@/services/ai/AiProviderError"
import { CodexProvider } from "@/services/ai/providers/CodexProvider"
import { type CliRunInput, type CliRunResult, type CliRunner } from "@/services/ai/providers/cliRunner"

describe("CodexProvider", () => {
  it("requires a command and a model", () => {
    expect(() => new CodexProvider({ command: undefined, model: "gpt-5-codex" })).toThrow(AiProviderError)
    expect(() => new CodexProvider({ command: "codex", model: undefined })).toThrow(AiProviderError)
  })

  it("verifies authentication via `codex login status`", async () => {
    const calls: CliRunInput[] = []
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, onRun: (input) => calls.push(input) })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(calls[0]?.args).toEqual(["login", "status"])
  })

  it("throws when the auth check exits non-zero", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "not logged in" })
    })

    await expect(provider.checkConnection()).rejects.toMatchObject({
      code: "connection-failed",
      providerId: "codex"
    })
  })

  it("runs exec with json output and parses the agent message and usage", async () => {
    let captured: CliRunInput | undefined
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "코덱스 응답" } }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 50, reasoning_output_tokens: 12 }
      })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner =>
        createFakeRunner({
          exitCode: 0,
          stdout,
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

    expect(captured?.command).toBe("codex")
    expect(captured?.args).toEqual([
      "exec",
      "--model",
      "gpt-5-codex",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json"
    ])
    expect(captured?.stdin).toBe("지시문\n\n본문")
    expect(response.providerId).toBe("codex")
    expect(response.model).toBe("gpt-5-codex")
    expect(response.text).toBe("코덱스 응답")
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 40 })
  })

  it("does not add reasoning tokens onto output tokens", async () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 72, reasoning_output_tokens: 65 }
      })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.usage?.outputTokens).toBe(72)
  })

  it("routes cost through the pricing path when usage is present", async () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.usage).toBeDefined()
    expect(response.costUsd).toBe(0)
  })

  it("falls back to plain stdout when json is not emitted", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "  코덱스 응답  \n" })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response).toEqual({ providerId: "codex", model: "gpt-5-codex", text: "코덱스 응답" })
  })

  it("maps a non-zero exit code to a generation error", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "boom" })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    ).rejects.toMatchObject({ code: "generation-failed", providerId: "codex" })
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
