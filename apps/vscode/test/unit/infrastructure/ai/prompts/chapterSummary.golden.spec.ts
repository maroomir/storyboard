import { describe, expect, it } from "vitest"

import { ChapterSummaryPrompt } from "@storyboard/story-ai"

describe("ChapterSummaryPrompt golden", () => {
  const input = { chapterTitle: "3장 폭우", body: "비가 쏟아졌다.\n\n엘리아는 창가에 서 있었다." }

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(ChapterSummaryPrompt.build(input, variant)).toMatchSnapshot()
  })
})
