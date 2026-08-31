import { describe, expect, it } from "vitest"

import { AiProviderError, CodexProvider } from '@storyboard/story-ai';
import type { CliRunInput, CliRunner, CliRunResult } from '@storyboard/story-ai';
describe("CodexProvider", () => {
  it("requires a command and a model", () => {
    expect(() => new CodexProvider({ command: undefined, model: "gpt-5.5" })).toThrow(AiProviderError)
    expect(() => new CodexProvider({ command: "codex", model: undefined })).toThrow(AiProviderError)
  })

  it("verifies authentication via `codex login status`", async () => {
    const calls: CliRunInput[] = []
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, onRun: (input) => calls.push(input) })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(calls[0]?.args).toEqual(["login", "status"])
  })

  it("throws when the auth check exits non-zero", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "not logged in" })
    })

    await expect(provider.checkConnection()).rejects.toMatchObject({
      code: "connection-failed",
      providerId: "codex"
    })
  })

  it("tags a missing binary (ENOENT) as a not-installed connection failure", async () => {
    const enoent = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => async () => {
        throw enoent
      }
    })

    await expect(provider.checkConnection()).rejects.toMatchObject({
      code: "connection-failed",
      providerId: "codex",
      connectionReason: "not-installed"
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
      model: "gpt-5.5",
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
      "gpt-5.5",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json"
    ])
    expect(captured?.stdin).toBe("지시문\n\n본문")
    expect(response.providerId).toBe("codex")
    expect(response.model).toBe("gpt-5.5")
    expect(response.text).toBe("코덱스 응답")
    expect(response.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 40 })
  })

  it("passes reasoning effort as a -c config override when configured", async () => {
    const calls: CliRunInput[] = []
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "ok", onRun: (input) => calls.push(input) })
    })

    await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(calls[0]?.args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-terra",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--json",
      "-c",
      'model_reasoning_effort="high"'
    ])
  })

  it("omits the reasoning effort override for blank values", async () => {
    const calls: CliRunInput[] = []
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      reasoningEffort: "  ",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "ok", onRun: (input) => calls.push(input) })
    })

    await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(calls[0]?.args).not.toContain("-c")
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
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.usage?.outputTokens).toBe(72)
  })

  it("records usage with zero subscription cost when usage is present", async () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.usage).toBeDefined()
    expect(response.costUsd).toBe(0)
  })

  it("falls back to plain stdout when json is not emitted", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "  코덱스 응답  \n" })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response).toEqual({ providerId: "codex", model: "gpt-5.5", text: "코덱스 응답" })
  })

  it("applies the default generate timeout and honors an override", async () => {
    const calls: CliRunInput[] = []
    const makeProvider = (generateTimeoutMs?: number): CodexProvider =>
      new CodexProvider({
        command: "codex",
        model: "gpt-5.5",
        generateTimeoutMs,
        createRunner: (): CliRunner =>
          createFakeRunner({ exitCode: 0, stdout: "ok", onRun: (input) => calls.push(input) })
      })

    await makeProvider().generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    expect(calls[0]?.timeoutMs).toBe(600_000)

    await makeProvider(300_000).generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    expect(calls[1]?.timeoutMs).toBe(300_000)
  })

  it("returns empty text when json yields no agent message instead of echoing the stream", async () => {
    const stdout = [
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 5, output_tokens: 0 } })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.text).toBe("")
  })

  it("does not let an empty later turn clobber earlier usage", async () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 20 } }),
      JSON.stringify({ type: "turn.completed", usage: {} })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })

    expect(response.usage).toEqual({ inputTokens: 30, outputTokens: 20 })
  })

  it("maps a non-zero exit code to a generation error", async () => {
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "boom" })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    ).rejects.toMatchObject({ code: "generation-failed", providerId: "codex" })
  })

  it("surfaces JSONL failure messages when exec exits non-zero", async () => {
    const stdout = [
      JSON.stringify({ type: "item.completed", item: { type: "error", message: "fallback metadata" } }),
      JSON.stringify({
        type: "error",
        message: JSON.stringify({
          type: "error",
          status: 400,
          error: {
            type: "invalid_request_error",
            message: "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account."
          }
        })
      })
    ].join("\n")
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5.5",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stdout })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "본문" }] })
    ).rejects.toThrow("not supported when using Codex with a ChatGPT account")
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
