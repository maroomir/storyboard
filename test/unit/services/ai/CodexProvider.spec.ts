import { describe, expect, it } from "vitest"

import { AiProviderError } from "@/services/ai/AiProviderError"
import { CodexProvider } from "@/services/ai/providers/CodexProvider"
import { type CliRunInput, type CliRunResult, type CliRunner } from "@/services/ai/providers/cliRunner"

describe("CodexProvider", () => {
  it("requires a command and a model", () => {
    expect(() => new CodexProvider({ command: undefined, model: "gpt-5-codex" })).toThrow(AiProviderError)
    expect(() => new CodexProvider({ command: "codex", model: undefined })).toThrow(AiProviderError)
  })

  it("checks connection by running --version", async () => {
    const calls: CliRunInput[] = []
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner => createFakeRunner({ exitCode: 0, onRun: (input) => calls.push(input) })
    })

    await expect(provider.checkConnection()).resolves.toBe(true)
    expect(calls[0]?.args).toEqual(["--version"])
  })

  it("runs exec in a read-only sandbox and combines system and user into stdin", async () => {
    let captured: CliRunInput | undefined
    const provider = new CodexProvider({
      command: "codex",
      model: "gpt-5-codex",
      createRunner: (): CliRunner =>
        createFakeRunner({
          exitCode: 0,
          stdout: "  코덱스 응답  \n",
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
    expect(captured?.args).toEqual(["exec", "--model", "gpt-5-codex", "--sandbox", "read-only", "--skip-git-repo-check"])
    expect(captured?.stdin).toBe("지시문\n\n본문")
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
