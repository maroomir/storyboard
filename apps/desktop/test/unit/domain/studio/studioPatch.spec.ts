import { describe, expect, it } from "vitest"

import { applyStudioPatch } from "@/domain/studio/studioPatch"
import type { StudioPatchPayload } from "@/shared/messaging"

const characterCard = [
  "type: character",
  "id: seorin",
  "name: 서린",
  "role: main",
  "traits:",
  "  - 냉소적"
].join("\n")

function cardPatch(
  changes: readonly {
    field: string
    value: string | string[] | Record<string, string>[]
  }[]
): StudioPatchPayload {
  return { target: "card", changes }
}

describe("applyStudioPatch for cards", () => {
  it("replaces a list field wholesale and re-serializes canonically", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "traits", value: ["냉소적", "불을 두려워함"] }]),
      "entityCard"
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.text : "").toContain("불을 두려워함")
    expect(result.ok ? result.text : "").toContain("냉소적")
    expect(result.ok ? result.changedFields : []).toEqual(["traits"])
  })

  it("replaces a scalar field", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "role", value: "supporting" }]),
      "entityCard"
    )

    expect(result.ok ? result.text : "").toContain("role: supporting")
  })

  it("refuses to change the card id", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "id", value: "other" }]),
      "entityCard"
    )

    expect(result).toEqual({
      ok: false,
      message: "id 필드는 대화로 바꿀 수 없습니다."
    })
  })

  it("refuses to change the card type", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "type", value: "location" }]),
      "entityCard"
    )

    expect(result.ok).toBe(false)
  })

  it("rejects a value that breaks the card schema", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "name", value: "" }]),
      "entityCard"
    )

    expect(result.ok).toBe(false)
  })

  it("rejects a patch against an unreadable card", () => {
    const result = applyStudioPatch(
      "not a card",
      cardPatch([{ field: "role", value: "main" }]),
      "entityCard"
    )

    expect(result).toEqual({
      ok: false,
      message: "카드를 읽을 수 없어 수정을 적용하지 못했습니다."
    })
  })
})

describe("applyStudioPatch for drafts", () => {
  const body = "0123456789"

  it("replaces one range", () => {
    const result = applyStudioPatch(
      body,
      { target: "draft", replacements: [{ startOffset: 2, endOffset: 5, newText: "XY" }] },
      "draft"
    )

    expect(result.ok ? result.text : "").toBe("01XY56789")
  })

  it("applies several ranges without shifting each other", () => {
    const result = applyStudioPatch(
      body,
      {
        target: "draft",
        replacements: [
          { startOffset: 6, endOffset: 8, newText: "B" },
          { startOffset: 1, endOffset: 3, newText: "AAAA" }
        ]
      },
      "draft"
    )

    expect(result.ok ? result.text : "").toBe("0AAAA345B89")
  })

  it("inserts without deleting when the range is empty", () => {
    const result = applyStudioPatch(
      body,
      { target: "draft", replacements: [{ startOffset: 5, endOffset: 5, newText: "-" }] },
      "draft"
    )

    expect(result.ok ? result.text : "").toBe("01234-56789")
  })

  it("refuses a range that runs past the body", () => {
    const result = applyStudioPatch(
      body,
      { target: "draft", replacements: [{ startOffset: 8, endOffset: 40, newText: "X" }] },
      "draft"
    )

    expect(result).toEqual({ ok: false, message: "수정 범위가 본문을 벗어났습니다." })
  })

  it("refuses overlapping ranges", () => {
    const result = applyStudioPatch(
      body,
      {
        target: "draft",
        replacements: [
          { startOffset: 1, endOffset: 5, newText: "A" },
          { startOffset: 3, endOffset: 7, newText: "B" }
        ]
      },
      "draft"
    )

    expect(result).toEqual({ ok: false, message: "수정 범위가 서로 겹칩니다." })
  })
})

const sceneCard = [
  "type: scene",
  "id: 01-intro",
  "title: 첫 등교",
  "characters:",
  "  - seorin",
  "location: subway",
  "purpose: 인물 소개",
  "summary: 서린이 지하철에서 지호를 마주친다."
].join("\n")

describe("applyStudioPatch for scene cards", () => {
  it("rewrites a narrative field", () => {
    const result = applyStudioPatch(
      sceneCard,
      cardPatch([{ field: "conflict", value: "서린이 지호를 피하려 한다" }]),
      "sceneCard"
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.text : "").toContain("conflict: 서린이 지호를 피하려 한다")
    expect(result.ok ? result.text : "").toContain("location: subway")
  })

  it("rewrites a list field wholesale", () => {
    const result = applyStudioPatch(
      sceneCard,
      cardPatch([{ field: "foreshadowing", value: ["지호의 상처", "닫히는 문"] }]),
      "sceneCard"
    )

    expect(result.ok ? result.text : "").toContain("지호의 상처")
    expect(result.ok ? result.text : "").toContain("닫히는 문")
  })

  it("refuses to touch the cast list", () => {
    const result = applyStudioPatch(
      sceneCard,
      cardPatch([{ field: "characters", value: ["seorin", "jiho"] }]),
      "sceneCard"
    )

    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.message).toContain("characters")
  })

  it("refuses to touch grounding, location and the id", () => {
    for (const field of ["grounding", "location", "id", "targetWordCount", "povCharacter"]) {
      const result = applyStudioPatch(sceneCard, cardPatch([{ field, value: "x" }]), "sceneCard")
      expect(result.ok).toBe(false)
    }
  })

  it("rejects a patch against an unreadable scene card", () => {
    const result = applyStudioPatch(
      "not a scene",
      cardPatch([{ field: "summary", value: "x" }]),
      "sceneCard"
    )

    expect(result).toEqual({
      ok: false,
      message: "씬 카드를 읽을 수 없어 수정을 적용하지 못했습니다."
    })
  })
})

describe("applyStudioPatch shape guards", () => {
  it("refuses a draft-shaped patch against a card", () => {
    const result = applyStudioPatch(
      characterCard,
      { target: "draft", replacements: [{ startOffset: 0, endOffset: 1, newText: "x" }] },
      "entityCard"
    )

    expect(result).toEqual({ ok: false, message: "카드에는 필드 수정만 적용할 수 있습니다." })
  })

  it("refuses a card-shaped patch against a draft", () => {
    const result = applyStudioPatch(
      "본문",
      cardPatch([{ field: "summary", value: "x" }]),
      "draft"
    )

    expect(result).toEqual({
      ok: false,
      message: "초안에는 본문 구간 수정만 적용할 수 있습니다."
    })
  })
})

describe("applyStudioPatch for a character arc", () => {
  it("writes a structured arc list", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([
        {
          field: "arc",
          value: [
            { stage: "의심", summary: "익숙한 빛깔을 느낀다", sceneRef: "02-the-name" },
            { stage: "결단", summary: "관계를 책임지는 쪽으로 돌아선다" }
          ]
        }
      ]),
      "entityCard"
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.text : "").toContain("stage: 의심")
    expect(result.ok ? result.text : "").toContain("sceneRef: 02-the-name")
    expect(result.ok ? result.text : "").toContain("stage: 결단")
  })

  it("rejects an arc entry that is missing its summary", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "arc", value: [{ stage: "의심" }] }]),
      "entityCard"
    )

    expect(result.ok).toBe(false)
  })

  it("clears a list field with an empty list", () => {
    const result = applyStudioPatch(
      characterCard,
      cardPatch([{ field: "traits", value: [] }]),
      "entityCard"
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? result.text : "").not.toContain("냉소적")
  })
})
