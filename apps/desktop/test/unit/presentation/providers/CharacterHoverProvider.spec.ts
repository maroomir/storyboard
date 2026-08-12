import { describe, expect, it } from "vitest"

import { buildCharacterHoverMarkdown } from "@/presentation/providers/CharacterHoverProvider"
import type { CharacterCard } from '@seedkernel/wasm';

describe("CharacterHoverProvider helpers", () => {
  it("renders compact character summary markdown", () => {
    const character: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      profile: "명랑한 주인공",
      description: ["상황을 빠르게 파악한다."],
      traits: ["침착함", "리더십"],
      recentDialogues: ["괜찮아, 내가 해볼게."],
      relations: [{ target: "jihoon", type: "friend" }]
    }

    const markdown = buildCharacterHoverMarkdown({
      character,
      relatedCharacterNames: ["지훈"]
    })

    expect(markdown.value).toContain("### 엘리아")
    expect(markdown.value).toContain("명랑한 주인공")
    expect(markdown.value).toContain("침착함")
    expect(markdown.value).toContain("괜찮아, 내가 해볼게.")
    expect(markdown.value).toContain("관계: 지훈")
  })
})
