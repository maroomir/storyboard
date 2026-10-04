import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { parsePromptResource, promptResourceKeys, promptResources } from "@storyboard/story-ai"

const promptsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/story-ai/src/ai/prompts"
)

const modulePath = (key: string): string => path.join(promptsDirectory, `${key}.ts`)

// temperature 와 maxTokens 는 프롬프트 리소스 파일의 머리말에 있다. 머리말이 없거나 모듈이 값을
// 직접 적기 시작하는 순간, 그리고 «검사류는 낮게, 창작류는 높게»의 범위를 벗어나는 순간을 잡는다.
describe("prompt tuning front-matter", () => {
  it("names a real prompt module for every resource", () => {
    for (const key of promptResourceKeys()) {
      expect(existsSync(modulePath(key)), `${key} has no prompt module`).toBe(true)
    }
  })

  it("keeps every prompt reading its own front-matter, not a literal", () => {
    for (const key of promptResourceKeys()) {
      const source = readFileSync(modulePath(key), "utf8")

      if (!source.includes("config:")) {
        continue
      }

      expect(source, `${key} still spells its config out`).toContain(
        `config: promptTuning('${key}')`
      )
    }
  })

  it("keeps every resource's config inside a usable range", () => {
    for (const key of promptResourceKeys()) {
      const config = promptResources.config(key)

      expect(config.temperature, `${key} temperature`).toBeGreaterThanOrEqual(0)
      expect(config.temperature, `${key} temperature`).toBeLessThanOrEqual(1)
      expect(config.maxTokens, `${key} maxTokens`).toBeGreaterThan(0)
    }
  })

  it("rejects a front-matter it cannot read", () => {
    expect(() => parsePromptResource("x", "---\ntemperature: 0.5\n")).toThrow("닫히지 않았습니다")
    expect(() => parsePromptResource("x", "---\nheat: 0.5\nmaxTokens: 10\n---\n")).toThrow(
      "잘못되었습니다"
    )
    expect(() => parsePromptResource("x", "---\ntemperature 0.5\n---\n")).toThrow(
      "이해할 수 없습니다"
    )
    expect(() => parsePromptResource("x", "---\ntemperature: warm\nmaxTokens: 10\n---\n")).toThrow(
      "잘못되었습니다"
    )
    expect(() =>
      parsePromptResource("x", "---\ntemperature: 0.5\nmaxTokens: 10\nreasoningEffort: max\n---\n")
    ).toThrow("잘못되었습니다")
  })

  it("reads an optional reasoning effort, which the note prompts set low", () => {
    const resource = parsePromptResource(
      "x",
      "---\ntemperature: 0.5\nmaxTokens: 10\nreasoningEffort: low\n---\n## system\n지시\n## user\n본문\n"
    )

    expect(resource.config).toEqual({ temperature: 0.5, maxTokens: 10, reasoningEffort: "low" })
    expect(promptResources.config("noteExtraction").reasoningEffort).toBe("low")
    expect(promptResources.config("noteSynthesis").reasoningEffort).toBe("low")
    expect(promptResources.config("backgroundDescription").reasoningEffort).toBeUndefined()
  })
})
