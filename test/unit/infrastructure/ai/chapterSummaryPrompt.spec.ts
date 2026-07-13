import { describe, expect, it } from "vitest"

import { ChapterSummaryPrompt } from "@/infrastructure/ai/prompts/chapterSummary"

const input = { chapterTitle: "1장", body: "엘리아가 학교에 도착했다." }

describe("ChapterSummaryPrompt", () => {
  it("includes the chapter title and body in the user block", () => {
    const artifact = ChapterSummaryPrompt.build(input, "generic")

    expect(artifact.system.length).toBeGreaterThan(0)
    expect(artifact.user).toContain("1장")
    expect(artifact.user).toContain("엘리아가 학교에 도착했다.")
  })

  it("keeps the xs system block shorter than generic", () => {
    expect(ChapterSummaryPrompt.build(input, "xs").system.length).toBeLessThan(
      ChapterSummaryPrompt.build(input, "generic").system.length
    )
  })
})
