import { describe, expect, it } from "vitest"

import { DraftCritiquePrompt, type DraftCritiqueInput } from "@storyboard/story-ai"

describe("DraftCritiquePrompt golden", () => {
  const full: DraftCritiqueInput = {
    body: "<!-- scene: 001 -->\n엘리아가 등대 아래 섰다.",
    intent: " 재회의 긴장 ",
    characters: ["엘리아", "준"],
    characterCards: ["[엘리아] 역할: main\n말투: 존댓말", "[준] 역할: side"],
    facts: ["엘리아는 의사다", "도시는 항구다"],
    styleConstraints: ["짧은 문장", "현재형 금지"],
    qualityCriteria: ["갈등이 드러난다", "감각 묘사가 있다"],
    styleDirective: {
      narration: { person: "third", knowledge: "witnessed", focal: "엘리아", tense: "past", voice: ["건조하다", "냉소적이다"] },
      genre: "누아르",
      relationStage: "재회"
    },
    hasSceneMarkers: true
  }
  const bare: DraftCritiqueInput = { body: "본문만.", intent: "   ", characters: [], facts: [] }
  const emptyLists: DraftCritiqueInput = {
    ...bare,
    intent: "의도",
    characterCards: [],
    styleConstraints: [],
    qualityCriteria: [],
    styleDirective: { narration: { voice: [] } },
    hasSceneMarkers: false
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(DraftCritiquePrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(DraftCritiquePrompt.build(bare, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("treats empty lists and an empty narration as missing for the %s variant", (variant) => {
    expect(DraftCritiquePrompt.build(emptyLists, variant)).toMatchSnapshot()
  })

  it("renders a narration without a voice", () => {
    expect(
      DraftCritiquePrompt.build({ ...bare, styleDirective: { narration: { person: "first" } } })
    ).toMatchSnapshot()
  })
})
