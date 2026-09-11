import { describe, expect, it } from "vitest"

import { AiProviderError, GeminiCliProvider } from '@storyboard/story-ai';
import type { CliRunInput, CliRunner, CliRunResult } from '@storyboard/story-ai';
describe("GeminiCliProvider", () => {
  it("requires a command and a model", () => {
    expect(() => new GeminiCliProvider({ command: undefined, model: "flash" })).toThrow(AiProviderError)
    expect(() => new GeminiCliProvider({ command: "gemini", model: undefined })).toThrow(AiProviderError)
  })

  it("verifies the install through `gemini --version`", async () => {
    const calls: CliRunInput[] = []
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "0.41.2", onRun: (input) => calls.push(input) })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(calls[0]?.args).toEqual(["--version"])
  })

  it("tags a missing binary (ENOENT) as a not-installed connection failure", async () => {
    const enoent = Object.assign(new Error("spawn gemini ENOENT"), { code: "ENOENT" })
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => async () => {
        throw enoent
      }
    })

    await expect(provider.checkConnection()).rejects.toMatchObject({
      code: "connection-failed",
      providerId: "gemini-cli",
      connectionReason: "not-installed"
    })
  })

  it("runs headless with json output, feeds the prompt over stdin, and parses response and usage", async () => {
    let captured: CliRunInput | undefined
    const stdout = JSON.stringify({
      response: "제미나이 응답",
      stats: {
        models: {
          "gemini-2.5-flash": { tokens: { prompt: 120, candidates: 40, thoughts: 10, cached: 20, total: 170 } }
        }
      }
    })
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout, onRun: (input) => (captured = input) })
    })

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [
        { role: "system", content: "지시문" },
        { role: "user", content: "본문" }
      ]
    })

    expect(captured?.args).toEqual(["--model", "flash", "--output-format", "json"])
    expect(captured?.args).not.toContain("-p")
    expect(captured?.stdin).toBe("지시문\n\n본문")
    expect(response).toEqual({
      providerId: "gemini-cli",
      model: "flash",
      text: "제미나이 응답",
      usage: { inputTokens: 120, outputTokens: 50, cacheReadInputTokens: 20 }
    })
  })

  it("sums usage across every model the CLI actually answered with", async () => {
    const stdout = JSON.stringify({
      response: "ok",
      stats: {
        models: {
          "gemini-2.5-pro": { tokens: { prompt: 100, candidates: 10 } },
          "gemini-2.5-flash": { tokens: { prompt: 50, candidates: 5 } }
        }
      }
    })
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "pro",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })

    expect(response.usage).toEqual({ inputTokens: 150, outputTokens: 15 })
  })

  it("falls back to plain stdout when the CLI does not emit json", async () => {
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, stdout: "평문 응답\n" })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })

    expect(response.text).toBe("평문 응답")
    expect(response.usage).toBeUndefined()
  })

  it("turns exit 41 into a login hint", async () => {
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 41, stderr: "Please set an Auth method" })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ code: "generation-failed", message: expect.stringContaining("로그인") })
  })

  // Observed with gemini-cli 0.58.0: a cached individual login the service no longer accepts.
  it("treats an `Error authenticating` stderr with another exit code as a login failure too", async () => {
    const stderr = "Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals."
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 55, stderr })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ message: expect.stringContaining("IneligibleTierError") })
  })

  // gemini-cli writes warnings to stderr on runs that succeed; a good answer must survive them.
  it("keeps a successful answer even when stderr mentions authentication", async () => {
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner =>
        createFakeRunner({
          exitCode: 0,
          stdout: JSON.stringify({ response: "정상 응답" }),
          stderr: "Error authenticating with cached credentials, retrying with the fallback method"
        })
    })

    const response = await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })

    expect(response.text).toBe("정상 응답")
  })

  it("surfaces a json error object and keeps the quota phrasing for the fallback detector", async () => {
    const stdout = JSON.stringify({
      error: { type: "TerminalQuotaError", message: "You have exhausted your daily quota on this model.", code: 429 }
    })
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "pro",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stdout })
    })

    let caught: unknown
    try {
      await provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ code: "generation-failed", providerId: "gemini-cli" })
    expect((caught as Error).message).toContain("exhausted your daily quota")
  })

  it("reports a non-zero exit with stderr when there is no json error", async () => {
    const provider = new GeminiCliProvider({
      command: "gemini",
      model: "flash",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 1, stderr: "boom" })
    })

    await expect(
      provider.generate({ taskName: "sceneDraft", messages: [{ role: "user", content: "x" }] })
    ).rejects.toMatchObject({ message: expect.stringContaining("boom") })
  })
})

interface FakeRunnerOptions {
  readonly exitCode: number
  readonly stdout?: string
  readonly stderr?: string
  readonly onRun?: (input: CliRunInput) => void
}

function createFakeRunner(options: FakeRunnerOptions): CliRunner {
  return async (input: CliRunInput): Promise<CliRunResult> => {
    options.onRun?.(input)
    return { stdout: options.stdout ?? "", stderr: options.stderr ?? "", exitCode: options.exitCode }
  }
}
