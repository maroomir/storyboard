import { describe, expect, it } from "vitest"

import type { Character } from "@/domain/Character"
import { PersonaGenerationPrompt } from "@/services/ai/prompts/personaGeneration"

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
})
