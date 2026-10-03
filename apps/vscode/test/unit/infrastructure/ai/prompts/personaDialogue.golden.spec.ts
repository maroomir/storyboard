import { describe, expect, it } from "vitest"

import { PersonaDialoguePrompt, type StyleDirective } from "@storyboard/story-ai"
import type { Background, SceneGrounding } from "@storyboard/story-model"

describe("PersonaDialoguePrompt golden", () => {
  const situation = "엘리아가 문을 연다.\n준이 뒤따른다."
  const background: Background = {
    type: "location",
    id: "school",
    name: "학교",
    locationKind: "place",
    description: ["오래된 교실", "창이 크다"],
    characterIds: [],
    tags: ["학원", "봄"]
  }
  const bareBackground: Background = { ...background, description: [], tags: [] }
  const personas = new Map([
    ["엘리아", "나는 침착하다.\n말수가 적다."],
    ["준", "나는 성급하다."]
  ])
  const grounding: SceneGrounding = { incident: "편지 발견", place: "교실", relation: "경계", time: "방과 후" }
  const fullStyle: StyleDirective = {
    narration: { person: "first", knowledge: "witnessed", focal: "엘리아" },
    genre: "청춘",
    styleConstraints: ["간결체"],
    prohibitions: ["무근거 부활 금지"],
    relationStage: "경계",
    targetWordCount: 3000,
    craftContract: { banTelling: false, stockGestureBlacklist: [], actionClarity: false }
  }

  it.each(["generic", "xs", "rich"] as const)("renders every block for the %s variant", (variant) => {
    expect(
      PersonaDialoguePrompt.build(situation, personas, background, "앞 장면 끝.", variant, fullStyle, grounding)
    ).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("leaves optional blocks out for the %s variant", (variant) => {
    expect(PersonaDialoguePrompt.build(situation, new Map(), bareBackground, undefined, variant)).toMatchSnapshot()
  })

  it.each([undefined, "witnessed", "retrospective", "omniscient"] as const)(
    "renders the interiority line for knowledge %s",
    (knowledge) => {
      const style: StyleDirective = knowledge ? { narration: { person: "first", knowledge } } : {}
      expect(PersonaDialoguePrompt.build(situation, personas, background, undefined, "generic", style)).toMatchSnapshot()
      expect(PersonaDialoguePrompt.build(situation, personas, background, undefined, "xs", style)).toMatchSnapshot()
    }
  )

  it("renders each background line alone", () => {
    expect(
      PersonaDialoguePrompt.build(situation, personas, { ...background, tags: [] }, undefined, "xs")
    ).toMatchSnapshot()
    expect(
      PersonaDialoguePrompt.build(situation, personas, { ...background, description: [""] }, undefined, "xs")
    ).toMatchSnapshot()
    expect(
      PersonaDialoguePrompt.build(situation, personas, { ...background, tags: undefined }, undefined, "generic")
    ).toMatchSnapshot()
  })

  it("renders empty persona text, partial grounding and blank inputs", () => {
    expect(
      PersonaDialoguePrompt.build(situation, new Map([["엘리아", ""], ["", "이름 없는 페르소나"]]), background)
    ).toMatchSnapshot()
    expect(
      PersonaDialoguePrompt.build(situation, new Map(), background, "앞 장면.", "generic", undefined, { place: "교실" })
    ).toMatchSnapshot()
    expect(PersonaDialoguePrompt.build("", new Map(), bareBackground, "", "generic", undefined, {})).toMatchSnapshot()
    expect(PersonaDialoguePrompt.build(situation, personas, background, "앞 장면.", "xs", undefined, grounding)).toMatchSnapshot()
  })
})
