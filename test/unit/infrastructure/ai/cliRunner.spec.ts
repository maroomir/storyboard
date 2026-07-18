import { EventEmitter } from "node:events"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]): unknown => spawnMock(...args)
}))

import { createDefaultCliRunner, isCommandNotFound, splitCliPrompt } from "@/infrastructure/ai/providers/cliRunner"

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
  readonly options: { readonly shell: boolean; readonly cwd?: string }
}

class FakeWritableStdin extends EventEmitter {
  public readonly chunks: string[] = []
  public ended = false

  public write(chunk: string): void {
    this.chunks.push(chunk)
  }

  public end(): void {
    this.ended = true
  }
}

class FakeChildProcess extends EventEmitter {
  public readonly stdin = new FakeWritableStdin()
  public readonly stdout = new EventEmitter()
  public readonly stderr = new EventEmitter()
  public readonly killSignals: string[] = []

  public kill(signal: string): void {
    this.killSignals.push(signal)
  }

  public emitStdout(text: string): void {
    this.stdout.emit("data", Buffer.from(text))
  }

  public emitStderr(text: string): void {
    this.stderr.emit("data", Buffer.from(text))
  }

  public emitClose(exitCode: number | null): void {
    this.emit("close", exitCode)
  }

  public emitError(error: Error): void {
    this.emit("error", error)
  }
}

function lastSpawnCall(): SpawnCall {
  const call = spawnMock.mock.calls.at(-1)
  if (!call) {
    throw new Error("spawn was not called")
  }
  return { command: call[0] as string, args: call[1] as string[], options: call[2] as SpawnCall["options"] }
}

let child: FakeChildProcess

beforeEach(() => {
  child = new FakeChildProcess()
  spawnMock.mockReset()
  spawnMock.mockReturnValue(child)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createDefaultCliRunner", () => {
  it("invokes spawn with shell:false and the args array verbatim", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: ["-p", "--model", "sonnet"], cwd: "/tmp" })

    child.emitClose(0)
    await running

    const call = lastSpawnCall()
    expect(call.command).toBe("claude")
    expect(call.args).toEqual(["-p", "--model", "sonnet"])
    expect(call.options.shell).toBe(false)
    expect(call.options.cwd).toBe("/tmp")
  })

  it("writes stdin then ends the stream", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [], stdin: "프롬프트 본문" })

    child.emitClose(0)
    await running

    expect(child.stdin.chunks).toEqual(["프롬프트 본문"])
    expect(child.stdin.ended).toBe(true)
  })

  it("ends stdin even when no stdin is provided", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [] })

    child.emitClose(0)
    await running

    expect(child.stdin.chunks).toEqual([])
    expect(child.stdin.ended).toBe(true)
  })

  it("never passes the prompt as a command-line argument", async () => {
    const runner = createDefaultCliRunner()
    const secretPrompt = "사용자 입력 $(rm -rf /)"
    const running = runner({ command: "claude", args: ["-p", "--model", "sonnet"], stdin: secretPrompt })

    child.emitClose(0)
    await running

    const call = lastSpawnCall()
    expect(call.args).not.toContain(secretPrompt)
    expect(call.args.join(" ")).not.toContain("rm -rf")
    expect(child.stdin.chunks).toEqual([secretPrompt])
  })

  it("swallows a stdin error instead of crashing the host", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [], stdin: "본문" })

    child.stdin.emit("error", new Error("EPIPE"))
    child.emitClose(0)

    await expect(running).resolves.toMatchObject({ exitCode: 0 })
  })

  it("resolves with accumulated stdout, stderr, and exit code on close", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [] })

    child.emitStdout("out-a")
    child.emitStdout("out-b")
    child.emitStderr("err-a")
    child.emitClose(0)

    await expect(running).resolves.toEqual({ stdout: "out-aout-b", stderr: "err-a", exitCode: 0 })
  })

  it("decodes multibyte characters split across chunk boundaries", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "codex", args: [] })

    const encoded = Buffer.from("빗소리가 굵어졌다")
    child.stdout.emit("data", encoded.subarray(0, 4))
    child.stdout.emit("data", encoded.subarray(4))
    child.emitClose(0)

    await expect(running).resolves.toMatchObject({ stdout: "빗소리가 굵어졌다" })
  })

  it("preserves a non-zero exit code on close", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [] })

    child.emitStderr("boom")
    child.emitClose(2)

    await expect(running).resolves.toEqual({ stdout: "", stderr: "boom", exitCode: 2 })
  })

  it("rejects when the child emits an error event", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "missing-binary", args: [] })

    const spawnError = new Error("ENOENT")
    child.emitError(spawnError)

    await expect(running).rejects.toBe(spawnError)
  })

  it("kills the child with SIGKILL and rejects when the timeout elapses", async () => {
    vi.useFakeTimers()
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [], timeoutMs: 1_000 })
    const settled = running.then(
      () => ({ outcome: "resolved" as const }),
      (error: Error) => ({ outcome: "rejected" as const, error })
    )

    vi.advanceTimersByTime(1_000)
    const result = await settled

    expect(child.killSignals).toEqual(["SIGKILL"])
    expect(result.outcome).toBe("rejected")
    if (result.outcome === "rejected") {
      expect(result.error.message).toContain("1000ms")
    }
  })

  it("ignores a late close after the timeout already rejected", async () => {
    vi.useFakeTimers()
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [], timeoutMs: 500 })
    const settled = running.then(
      () => "resolved" as const,
      () => "rejected" as const
    )

    vi.advanceTimersByTime(500)
    child.emitClose(0)

    await expect(settled).resolves.toBe("rejected")
  })

  it("ignores a late error after a successful close", async () => {
    const runner = createDefaultCliRunner()
    const running = runner({ command: "claude", args: [] })

    child.emitClose(0)
    child.emitError(new Error("too late"))

    await expect(running).resolves.toMatchObject({ exitCode: 0 })
  })
})

describe("isCommandNotFound", () => {
  it("detects ENOENT spawn errors and ignores everything else", () => {
    expect(isCommandNotFound(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }))).toBe(true)
    expect(isCommandNotFound(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false)
    expect(isCommandNotFound(new Error("plain"))).toBe(false)
    expect(isCommandNotFound("ENOENT")).toBe(false)
    expect(isCommandNotFound(null)).toBe(false)
  })
})

describe("splitCliPrompt", () => {
  it("joins system and non-system messages into separate prompts", () => {
    const split = splitCliPrompt([
      { role: "system", content: "지시 A" },
      { role: "system", content: "지시 B" },
      { role: "user", content: "본문 1" },
      { role: "assistant", content: "이전 응답" }
    ])

    expect(split).toEqual({ systemPrompt: "지시 A\n\n지시 B", userPrompt: "본문 1\n\n이전 응답" })
  })

  it("omits the system prompt key when there is no system message", () => {
    const split = splitCliPrompt([{ role: "user", content: "본문" }])

    expect(split.systemPrompt).toBeUndefined()
    expect(split.userPrompt).toBe("본문")
  })
})
