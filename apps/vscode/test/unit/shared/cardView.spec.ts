import { describe, expect, it } from "vitest"

import { buildCardView, type CardViewLookup, type Statement } from "@storyboard/story-model"

const hanaId = "11111111-1111-4111-8111-111111111111"
const seraId = "22222222-2222-4222-8222-222222222222"
const schoolId = "33333333-3333-4333-8333-333333333333"
const studio = { origin: "studio" } as const

const lookup: CardViewLookup = {
  nameOf: (elementId) => ({ [seraId]: "세라", [schoolId]: "학교" })[elementId]
}

describe("buildCardView", () => {
  it("summarises the header and groups statements by their facet's section", () => {
    const statements: readonly Statement[] = [
      { facet: "traits", value: "낯선 자리에서 먼저 말을 건다.", source: studio },
      { facet: "desire", value: "세라에게 인정받고 싶다.", source: studio },
      { facet: "relation", value: "소꿉친구, 지금은 데면데면", about: seraId, source: studio },
      { facet: "arc", value: "거절을 받아들이는 법을 배운다.", source: studio }
    ]

    const view = buildCardView(
      {
        header: {
          id: hanaId,
          slug: "hana",
          kind: "character",
          name: "하나",
          role: "main",
          attributes: { age: 17 },
          aliases: ["하니"]
        },
        statements
      },
      lookup
    )

    expect(view).toMatchObject({ kind: "character", slug: "hana", name: "하나" })
    expect(view.facts).toEqual(["주연", "17세", "별칭 하니"])
    expect(view.sections.map((section) => section.label)).toEqual([
      "성격",
      "말투",
      "관계",
      "변화",
      "묘사",
      "사실"
    ])
    expect(view.sections.find((section) => section.id === "personality")?.lines).toEqual([
      { text: "낯선 자리에서 먼저 말을 건다." },
      { text: "세라에게 인정받고 싶다." }
    ])
    expect(view.sections.find((section) => section.id === "relations")?.lines).toEqual([
      { text: "소꿉친구, 지금은 데면데면", label: "세라" }
    ])
    expect(view.sections.find((section) => section.id === "voice")?.lines).toEqual([])
  })

  it("names a scene's place and cast from the lookup", () => {
    const view = buildCardView(
      {
        header: {
          id: hanaId,
          slug: "rooftop",
          kind: "scene",
          title: "옥상",
          place: schoolId,
          cast: [seraId, "44444444-4444-4444-8444-444444444444"]
        },
        statements: [{ facet: "purpose", value: "둘이 처음 마주친다.", source: studio }]
      },
      lookup
    )

    expect(view.name).toBe("옥상")
    expect(view.facts).toEqual(["학교", "출연 세라, 44444444-4444-4444-8444-444444444444"])
    expect(view.sections[0]?.lines).toEqual([{ text: "둘이 처음 마주친다." }])
  })
})
