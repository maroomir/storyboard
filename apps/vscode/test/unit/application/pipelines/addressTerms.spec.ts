import { describe, expect, it } from "vitest"

import {
  findBeatCoinedAddressTerms,
  findKinshipAddressSubstitutions,
  planSectionWithheldAddressTerms,
  validateExpandedSection
} from "@storyboard/story-engine"
import type { CharacterCard } from "@storyboard/story-model"

const son: CharacterCard = {
  type: "character",
  id: "son",
  name: "아들",
  relations: [{ target: "mother", type: "모자", speech: "'엄마'라 부르며 존댓말을 쓴다" }]
}

describe("findBeatCoinedAddressTerms", () => {
  it("finds a nickname a later beat coins, not the lines it quotes (#188)", () => {
    const beats = [
      "현관에서 처음 마주친다",
      "\"설마 엘리트가 메스로 가른 건가\"라고 비꼬자, 이때부터 은하를 \"엘리트\"라 부른다",
      "\"엘리트\"라고 부르며 계속 놀린다"
    ]

    expect(findBeatCoinedAddressTerms(beats)).toEqual(["엘리트"])
  })

  it("leaves a term the first beat already uses", () => {
    expect(findBeatCoinedAddressTerms(["\"대장\"이라 부르며 들어온다", "다시 만난다"])).toEqual([])
  })
})

describe("planSectionWithheldAddressTerms", () => {
  it("withholds the term from sections before its first use in the skeleton", () => {
    const sections = ["현관에서 만났다.", "은하가 발끈했다. “엘리트 양반.”", "계속 엘리트라 불렀다."]

    expect(
      planSectionWithheldAddressTerms({ skeleton: sections.join("\n\n"), sections, terms: ["엘리트"] })
    ).toEqual([["엘리트"], [], []])
  })
})

describe("findKinshipAddressSubstitutions", () => {
  it("flags a family address the card does not use", () => {
    expect(
      findKinshipAddressSubstitutions({
        expanded: "“어머니, 제가 오늘 깨달은 바가 있는데요.”",
        section: "“엄마, 제가 오늘 깨달은 바가 있는데요.”",
        characters: [son]
      })
    ).toEqual([{ written: "어머니", expected: "엄마" }])
  })

  it("ignores narration, compound words and terms the skeleton already uses", () => {
    expect(
      findKinshipAddressSubstitutions({
        expanded: "어머니가 웃었다. “시어머니 댁에 가요.” “어머니.”",
        section: "“어머니.”",
        characters: [son]
      })
    ).toEqual([])
  })
})

describe("validateExpandedSection address", () => {
  it("reports an early nickname and a changed family address", () => {
    const violations = validateExpandedSection({
      skeleton: "“엄마, 다녀왔어요.”",
      section: "“엄마, 다녀왔어요.”",
      expanded: "“어머니, 다녀왔어요.” 나는 엘리트를 흘겨봤다.",
      characters: [son],
      targetLength: 10,
      withheldAddressTerms: ["엘리트"]
    })

    const details = violations.filter((violation) => violation.kind === "address").map((violation) => violation.detail)
    expect(details.join(" ")).toContain("«엘리트»")
    expect(details.join(" ")).toContain("«어머니» 대신 «엄마»")
  })
})
