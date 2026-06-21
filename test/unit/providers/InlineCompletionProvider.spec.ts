import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import {
  createInlineCompletionCacheKey,
  pruneInlineCompletionCache,
  shouldRunInlineCompletion,
  trimInlineCompletionPrefix
} from "@/providers/InlineCompletionProvider"

describe("InlineCompletionProvider helpers", () => {
  it("trims prefix to the most recent 1200 characters", () => {
    const long = `${"a".repeat(1199)}bc`
    const trimmed = trimInlineCompletionPrefix(long)

    expect(trimmed).toHaveLength(1200)
    expect(trimmed.startsWith("a")).toBe(true)
    expect(trimmed.endsWith("bc")).toBe(true)
  })

  it("builds stable cache keys with uri and cursor", () => {
    const document = {
      uri: {
        toString: () => "file:///tmp/storyboard/draft/01-opening.md"
      }
    } as unknown as vscode.TextDocument
    const key = createInlineCompletionCacheKey(
      document,
      { line: 3, character: 7 } as unknown as vscode.Position,
      "prefix"
    )

    expect(key).toContain("file:///tmp/storyboard/draft/01-opening.md")
    expect(key).toContain("3:7")
    expect(key.endsWith("::prefix")).toBe(true)
  })

  it("skips inline completion for CLI providers but allows API providers", () => {
    expect(shouldRunInlineCompletion("claude-code")).toBe(false)
    expect(shouldRunInlineCompletion("codex")).toBe(false)
    expect(shouldRunInlineCompletion("openai")).toBe(true)
    expect(shouldRunInlineCompletion("claude")).toBe(true)
    expect(shouldRunInlineCompletion("mock")).toBe(true)
  })

  it("prunes oldest entries when cache exceeds limit", () => {
    const cache = new Map<string, { value: string; updatedAt: number }>()

    for (let index = 0; index < 120; index += 1) {
      cache.set(`k-${index}`, { value: String(index), updatedAt: index })
    }

    pruneInlineCompletionCache(cache)

    expect(cache.size).toBe(100)
    expect(cache.has("k-0")).toBe(false)
    expect(cache.has("k-19")).toBe(false)
    expect(cache.has("k-20")).toBe(true)
    expect(cache.has("k-119")).toBe(true)
  })
})
