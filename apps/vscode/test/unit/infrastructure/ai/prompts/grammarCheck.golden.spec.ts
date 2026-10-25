import { describe, expect, it } from "vitest"

import { GrammarCheckPrompt } from "@storyboard/story-ai"

describe("GrammarCheckPrompt golden", () => {
  const body = "그는 학교에 갔다 . 그리고나서 밥을 먹었다"

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(GrammarCheckPrompt.build(body, variant)).toMatchSnapshot()
  })
})
