import { describe, expect, it, vi } from "vitest"

import { FallbackProvider, isUsageLimitError } from "@storyboard/story-ai"
import type { AiProvider } from "@storyboard/story-ai"

function provider(id: string, generate: AiProvider["generate"]): AiProvider {
  return {
    id: id as AiProvider["id"],
    displayName: id,
    checkConnection: async () => true,
    generate
  }
}

const request = { prompt: "x", taskName: "sceneDraft" } as never
const response = { text: "ok" } as never

describe("usage limit detection", () => {
  it("recognises the phrasings the CLI providers actually emit", () => {
    for (const message of [
      "You've hit your usage limit",
      "Upgrade to Pro to continue",
      "rate limit exceeded",
      "quota exhausted",
      "429 Too Many Requests"
    ]) {
      expect(isUsageLimitError(new Error(message))).toBe(true)
    }
  })

  it("does not treat an ordinary failure as a limit", () => {
    expect(isUsageLimitError(new Error("model returned invalid JSON"))).toBe(false)
  })
})

describe("FallbackProvider", () => {
  it("stays on the primary while it answers", async () => {
    const primary = vi.fn(async () => response)
    const fallback = vi.fn(async () => response)

    const subject = new FallbackProvider(provider("codex", primary), provider("claude-code", fallback))
    await subject.generate(request)

    expect(primary).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  // The switch is one-way: probing an exhausted provider again spends a call to learn what it
  // already said, and an unattended run has no one to wait for it.
  it("switches once on a usage limit and never goes back", async () => {
    const primary = vi.fn(async () => {
      throw new Error("usage limit reached")
    })
    const fallback = vi.fn(async () => response)
    const notices: string[] = []

    const subject = new FallbackProvider(
      provider("codex", primary),
      provider("claude-code", fallback),
      (message) => notices.push(message)
    )

    await subject.generate(request)
    await subject.generate(request)

    expect(primary).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(notices).toHaveLength(1)
  })

  it("lets an ordinary error through instead of masking it as exhaustion", async () => {
    const fallback = vi.fn(async () => response)
    const subject = new FallbackProvider(
      provider("codex", async () => {
        throw new Error("model returned invalid JSON")
      }),
      provider("claude-code", fallback)
    )

    await expect(subject.generate(request)).rejects.toThrow("invalid JSON")
    expect(fallback).not.toHaveBeenCalled()
  })
})
