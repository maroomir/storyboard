import { describe, expect, it } from "vitest"

import { DraftAugmentPrompt, type DraftAugmentInput } from "@storyboard/story-ai"

describe("DraftAugmentPrompt golden", () => {
  const augment: DraftAugmentInput = {
    target: "엘리아가 등대 아래 섰다.",
    scope: "draft",
    format: "novel",
    cards: ["[엘리아] 역할: main\n말투: 존댓말", "[배경: 항구] 새벽 안개"],
    facts: ["엘리아는 의사다", "도시는 항구다"],
    intent: "재회의 긴장"
  }
  const instructed: DraftAugmentInput = {
    ...augment,
    scope: "selection",
    instruction: "  더 차갑게 바꿔라  "
  }
  const bare: DraftAugmentInput = {
    target: "짧은 선택 영역.",
    scope: "selection",
    format: "screenplay",
    cards: [],
    facts: [],
    intent: "   ",
    instruction: "   "
  }
  const craftStyle = {
    craftContract: {
      banTelling: false,
      motifRepeatLimit: 3,
      stockGestureBlacklist: ["입술을 깨물었다"],
      requireCharacterInterior: false,
      actionClarity: true,
      modulateDensity: false
    }
  }

  it.each(["generic", "xs", "rich"] as const)("renders a draft augment for the %s variant", (variant) => {
    expect(DraftAugmentPrompt.build(augment, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("renders an instructed selection edit for the %s variant", (variant) => {
    expect(DraftAugmentPrompt.build(instructed, variant, craftStyle)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders a bare selection for the %s variant", (variant) => {
    expect(DraftAugmentPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("renders an uninstructed selection in screenplay form with a craft contract", () => {
    expect(DraftAugmentPrompt.build({ ...augment, scope: "selection", format: "screenplay" }, "generic", craftStyle)).toMatchSnapshot()
    expect(DraftAugmentPrompt.build({ ...augment, scope: "selection" }, "xs")).toMatchSnapshot()
  })

  it("renders an instructed draft in screenplay form", () => {
    expect(DraftAugmentPrompt.build({ ...instructed, scope: "draft", format: "screenplay" })).toMatchSnapshot()
  })
})
