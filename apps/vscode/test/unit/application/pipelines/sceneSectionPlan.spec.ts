import { describe, expect, it } from "vitest"

import {
  countRecapPhrases,
  findPlacesOffCoordinates,
  findRunAheadDialogue,
  planSectionTargetLengths,
  resolveSceneGenerationTuning,
  splitSkeletonIntoSections,
  trimRunAheadDialogue
} from "@storyboard/story-engine"

describe("splitSkeletonIntoSections — 고른 분할", () => {
  const paragraph = (n: number): string => `문단${n} ${"가".repeat(200)}`
  const lengthsOf = (sections: readonly string[]): number[] => sections.map((section) => section.length)

  it("passes a scene break that comes too early when the next one sits closer to the budget", () => {
    const groups = Array.from({ length: 6 }, (_, group) => [paragraph(group * 2), paragraph(group * 2 + 1)])
    const skeleton = groups.map((pair) => pair.join("\n\n")).join("\n\n---\n\n")

    const sections = splitSkeletonIntoSections(skeleton, 3)

    expect(sections).toHaveLength(3)
    expect(sections[0]?.endsWith("---")).toBe(true)
    expect(sections[1]?.endsWith("---")).toBe(true)
    const lengths = lengthsOf(sections)
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(paragraph(0).length)
  })

  it("re-budgets from what is left so an early cut does not pile the rest on the last section", () => {
    const skeleton = [
      paragraph(1),
      paragraph(2),
      "---",
      ...Array.from({ length: 10 }, (_, i) => paragraph(i + 3))
    ].join("\n\n")

    const [first, second, third] = lengthsOf(splitSkeletonIntoSections(skeleton, 3))

    expect(first).toBeLessThan(second as number)
    expect(Math.abs((second as number) - (third as number))).toBeLessThanOrEqual(paragraph(0).length * 2 + 2)
  })

  it("still prefers a scene break over a paragraph boundary when it is the nearest cut", () => {
    const skeleton = [paragraph(1), paragraph(2), "---", paragraph(3), paragraph(4), paragraph(5), "---", paragraph(6), paragraph(7), paragraph(8)].join("\n\n")

    const sections = splitSkeletonIntoSections(skeleton, 3)

    expect(sections).toHaveLength(3)
    expect(sections[0]?.endsWith("---")).toBe(true)
    expect(sections[1]?.endsWith("---")).toBe(true)
  })
})

describe("planSectionTargetLengths — 상한에 잘린 몫의 재분배", () => {
  it("adds up to the scene target when one slice is capped", () => {
    const targets = planSectionTargetLengths(["가".repeat(600), "나".repeat(300), "다".repeat(100)], 20000)

    expect(targets).toEqual([7000, 7000, 6000])
    expect(targets.reduce((sum, target) => sum + target, 0)).toBe(20000)
  })

  it("hands the excess out in proportion to the uncapped slices", () => {
    const targets = planSectionTargetLengths(["가".repeat(800), "나".repeat(100), "다".repeat(100)], 12000)

    expect(targets).toEqual([7000, 2500, 2500])
  })

  it("stops at the output limit when every slice is capped", () => {
    expect(planSectionTargetLengths(["가".repeat(500), "나".repeat(500)], 40000)).toEqual([7000, 7000])
  })

  it("leaves a plan that already fits untouched", () => {
    expect(planSectionTargetLengths(["가".repeat(600), "나".repeat(300), "다".repeat(100)], 10000)).toEqual([
      6000, 3000, 1000
    ])
  })
})

describe("splitSkeletonIntoSections — 대화 한복판", () => {
  it("cuts only between two narration paragraphs once the budget is met", () => {
    const narration = (label: string): string => `${label} ${"서술".repeat(60)}`
    const skeleton = [
      narration("가"),
      narration("나"),
      "\u201c너 원래 이런 애였어?\u201d",
      "\u201c아니, 그거 말고.\u201d",
      narration("다"),
      narration("라")
    ].join("\n\n")

    const sections = splitSkeletonIntoSections(skeleton, 2)

    expect(sections[0]).toContain("\u201c아니, 그거 말고.\u201d")
    expect(sections[0]?.endsWith("서술")).toBe(true)
    expect(sections[1]?.startsWith("라 ")).toBe(true)
  })
})

describe("findRunAheadDialogue", () => {
  const tuning = resolveSceneGenerationTuning()
  const skeleton = [
    "\u201c망고 먹을래?\u201d",
    "\u201c맛있네, 고마워.\u201d",
    "\u201c그때 너는 다 나눠줬잖아.\u201d"
  ].join("\n\n")
  const section = "\u201c망고 먹을래?\u201d\n\n\u201c맛있네, 고마워.\u201d"

  it("finds lines only the later skeleton has", () => {
    const expanded = `${section}\n\n은하가 웃었다.\n\n\u201c그때 너는 다 나눠줬잖아.\u201d`

    expect(findRunAheadDialogue(skeleton, section, expanded, tuning)).toEqual(["그때 너는 다 나눠줬잖아."])
  })

  it("trims the expansion from the paragraph that ran ahead", () => {
    const expanded = `${section}\n\n은하가 웃었다.\n\n\u201c그때 너는 다 나눠줬잖아.\u201d 은하가 말했다.`

    expect(trimRunAheadDialogue(expanded, ["그때 너는 다 나눠줬잖아."])).toBe(`${section}\n\n은하가 웃었다.`)
  })

  it("finds nothing when the expansion stays in its section", () => {
    expect(findRunAheadDialogue(skeleton, section, `${section}\n\n은하가 웃었다.`, tuning)).toEqual([])
  })
})

describe("findPlacesOffCoordinates", () => {
  const section = "성재가 소파에 앉았다.\n\n“형은 누나한테 왜 그래.”"
  const sectionPlaces = ["집 거실", "집 현관과 거실"]

  it("names a space the section sets up that no coordinate, fact or skeleton line mentions", () => {
    const expanded = "나는 서재로 걸음을 옮겼다. 성재가 방문을 열고 들어와 소파 얘기를 꺼냈다. 거실은 조용했다."

    expect(findPlacesOffCoordinates({ expanded, section, sectionPlaces })).toEqual(["서재"])
  })

  it("allows a space the background facts or the beat places name", () => {
    const expanded = "서재 쪽 복도를 지나 거실로 왔다. 현관문이 열렸다."

    expect(
      findPlacesOffCoordinates({ expanded, section, sectionPlaces, backgroundFacts: ["서재는 현관 옆 복도 끝에 있다"] })
    ).toEqual([])
  })

  it("judges nothing when the section has no place coordinates", () => {
    expect(findPlacesOffCoordinates({ expanded: "서재와 다락과 창고를 돌았다.", section, sectionPlaces: [] })).toEqual([])
  })
})

describe("countRecapPhrases", () => {
  it("counts every recap phrase in the section", () => {
    expect(countRecapPhrases("아까 거실에서의 정적과는 달랐다. 아까 식탁에서 나를 몰아붙이던 표정과는…")).toBe(2)
    expect(countRecapPhrases("나는 망고를 깎았다.")).toBe(0)
  })
})
