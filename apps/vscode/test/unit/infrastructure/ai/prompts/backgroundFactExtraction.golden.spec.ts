import { describe, expect, it } from "vitest"

import { BackgroundFactExtractionPrompt } from "@storyboard/story-ai"

describe("BackgroundFactExtractionPrompt golden", () => {
  const body = "새벽 안개가 부두를 덮었다.\n엘리아가 등대 아래 섰다."

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(BackgroundFactExtractionPrompt.build(body, "항구", variant)).toMatchSnapshot()
  })
})
