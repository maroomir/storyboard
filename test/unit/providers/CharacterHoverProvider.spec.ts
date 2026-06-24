import { describe, expect, it } from "vitest"

import { buildCharacterHoverMarkdown } from "@/providers/CharacterHoverProvider"
import type { CharacterCard } from "@/shared/card"

describe("CharacterHoverProvider helpers", () => {
  it("renders compact character summary markdown", () => {
    const character: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      description: "상황을 빠르게 파악한다.",
      traits: ["침착함", "리더십"],
      recentDialogues: ["괜찮아, 내가 해볼게."]
    }

    const markdown = buildCharacterHoverMarkdown({ character })

    expect(markdown.value).toContain("### 엘리아")
    expect(markdown.value).toContain("상황을 빠르게 파악한다.")
    expect(markdown.value).toContain("침착함")
    expect(markdown.value).toContain("괜찮아, 내가 해볼게.")
  })
})
