import { describe, expect, it } from "vitest"

import { DraftCondensePrompt, type DraftCondenseInput } from "@storyboard/story-ai"

describe("DraftCondensePrompt golden", () => {
  const full: DraftCondenseInput = {
    body: "긴 본문이 여기 있다.",
    format: "novel",
    targetLength: 1200,
    intent: "화해의 장면",
    facts: ["엘리아는 의사다", "도시는 항구다"],
    characterCards: ["[엘리아] 역할: main", "[준] 역할: side"]
  }
  const bare: DraftCondenseInput = { body: "본문만.", format: "screenplay", targetLength: 300 }
  const blankIntent: DraftCondenseInput = { ...bare, intent: "   ", facts: [], characterCards: [] }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(DraftCondensePrompt.build(full, variant)).toMatchSnapshot()
  })

  it("leaves optional blocks out", () => {
    expect(DraftCondensePrompt.build(bare)).toMatchSnapshot()
    expect(DraftCondensePrompt.build(blankIntent)).toMatchSnapshot()
  })
})
