import { describe, expect, it } from "vitest"

import { PersonaGenerationPrompt } from '@storyboard/story-ai';
import type { Character } from '@storyboard/story-format';
const baseCharacter: Character = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main"
}

describe("PersonaGenerationPrompt", () => {
  it("includes character attributes sorted by key in the user block", () => {
    const artifact = PersonaGenerationPrompt.build({
      ...baseCharacter,
      attributes: { sex: "female", age: 17, mbti: "ENFJ" }
    })

    expect(artifact.user).toContain("속성: age=17, mbti=ENFJ, sex=female")
  })

  it("omits the attributes line when no attributes are set", () => {
    const artifact = PersonaGenerationPrompt.build(baseCharacter)

    expect(artifact.user).not.toContain("속성:")
  })

  it("skips null attribute values", () => {
    const artifact = PersonaGenerationPrompt.build({
      ...baseCharacter,
      attributes: { mbti: "ENFJ", secret: null }
    })

    expect(artifact.user).toContain("속성: mbti=ENFJ")
    expect(artifact.user).not.toContain("secret")
  })

  it("includes the character desire as a goal line", () => {
    const artifact = PersonaGenerationPrompt.build({
      ...baseCharacter,
      desire: ["진짜 친구를 만들고 싶다", "인정받고 싶다"]
    })

    expect(artifact.user).toContain("목표: 진짜 친구를 만들고 싶다\n인정받고 싶다")
  })
})
