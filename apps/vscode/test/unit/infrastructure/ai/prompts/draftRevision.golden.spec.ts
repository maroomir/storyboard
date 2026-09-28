import { describe, expect, it } from "vitest"

import { DraftRevisionPrompt, type DraftRevisionInput } from "@storyboard/story-ai"

describe("DraftRevisionPrompt golden", () => {
  const full: DraftRevisionInput = {
    body: "엘리아가 교실로 들어왔다.\n\n---\n\n준이 따라왔다.",
    format: "novel",
    instructions: ["설정 모순: 눈동자 색을 녹색으로", "반복 줄이기"],
    intent: "주인공 소개",
    facts: ["엘리아 — 눈동자 색: 녹색", "도시는 항구다"],
    characterCards: ["[엘리아] 역할: main\n말투: 짧은 존댓말", "[준] 역할: side"]
  }
  const bare: DraftRevisionInput = {
    body: "본문만.",
    format: "screenplay",
    instructions: ["한 가지 지시"],
    intent: "   ",
    facts: []
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(DraftRevisionPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(DraftRevisionPrompt.build(bare, variant)).toMatchSnapshot()
    expect(DraftRevisionPrompt.build({ ...bare, characterCards: [] }, variant)).toMatchSnapshot()
    expect(DraftRevisionPrompt.build({ ...bare, intent: "", facts: ["사실 하나"] }, variant)).toMatchSnapshot()
    expect(DraftRevisionPrompt.build({ ...bare, characterCards: ["[준] 역할: side"] }, variant)).toMatchSnapshot()
  })

  it("renders an empty instruction list", () => {
    expect(DraftRevisionPrompt.build({ ...full, instructions: [] })).toMatchSnapshot()
    expect(DraftRevisionPrompt.build({ ...bare, instructions: [] })).toMatchSnapshot()
  })

  it("defaults to the generic variant", () => {
    expect(DraftRevisionPrompt.build(full)).toMatchSnapshot()
  })
})
