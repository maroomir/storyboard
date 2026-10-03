import { describe, expect, it } from "vitest"

import { PersonaGenerationPrompt, type StyleDirective } from "@storyboard/story-ai"
import type { Character } from "@storyboard/story-model"

describe("PersonaGenerationPrompt golden", () => {
  const bare: Character = { type: "character", id: "elia", name: "엘리아" }
  const full: Character = {
    ...bare,
    role: "main",
    voice: ["짧은 존댓말", "단정한 어조"],
    description: ["도서부원", "안경을 쓴다"],
    desire: ["진짜 친구를 만들고 싶다"],
    attributes: { sex: "female", age: 17, mbti: "ENFJ", secret: null },
    traits: ["침착함", "호기심", "고집"]
  }
  const style: StyleDirective = {
    narration: { person: "first", knowledge: "witnessed", focal: "엘리아" },
    genre: "청춘",
    styleConstraints: ["간결체"],
    prohibitions: ["무근거 부활 금지"],
    relationStage: "경계",
    targetWordCount: 3000
  }

  it.each(["generic", "xs", "rich"] as const)("renders every line for the %s variant", (variant) => {
    expect(PersonaGenerationPrompt.build(full, variant, style)).toMatchSnapshot()
  })

  it.each(["generic", "xs", "rich"] as const)("renders a bare character for the %s variant", (variant) => {
    expect(PersonaGenerationPrompt.build(bare, variant)).toMatchSnapshot()
  })

  it("renders each optional line alone", () => {
    expect(PersonaGenerationPrompt.build({ ...bare, voice: ["허세"] })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, description: ["설명"] })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, desire: ["목표"] })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, role: "side" })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, attributes: { age: 30 } })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, traits: ["용감함"] }, "xs")).toMatchSnapshot()
  })

  it("renders empty and oversized collections", () => {
    expect(
      PersonaGenerationPrompt.build({
        ...bare,
        voice: [],
        description: [""],
        attributes: { secret: null },
        traits: []
      })
    ).toMatchSnapshot()
    expect(
      PersonaGenerationPrompt.build({
        ...bare,
        traits: ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11", "t12"]
      })
    ).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build({ ...bare, traits: [""] })).toMatchSnapshot()
  })

  it("renders a style without voice-relevant fields", () => {
    expect(PersonaGenerationPrompt.build(full, "generic", { targetWordCount: 3000 })).toMatchSnapshot()
    expect(PersonaGenerationPrompt.build(full, "generic", { genre: "로맨스" })).toMatchSnapshot()
  })
})
