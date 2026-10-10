import { describe, expect, it } from "vitest"

import {
  findRunAheadDialogue,
  planSectionTargetLengths,
  resolveSceneGenerationTuning,
  splitSkeletonIntoSections,
  trimRunAheadDialogue
} from "@storyboard/story-engine"

// #106 실측: 장면 전환(---)이 잦은 뼈대에서 전환마다 예산의 절반만 차도 잘라 앞 구간이 일찍 닫히고,
// 뼈대의 44~47%가 마지막 구간에 몰렸다. 그 구간의 몫은 출력 상한에 잘려 버려져 구간 목표의 합이
// 씬 목표의 73%에 그쳤다 — 살붙임이 구간 목표를 다 채워도 분량이 닿지 않는 구조였다.
describe("splitSkeletonIntoSections — 고른 분할", () => {
  const paragraph = (n: number): string => `문단${n} ${"가".repeat(200)}`
  const lengthsOf = (sections: readonly string[]): number[] => sections.map((section) => section.length)

  it("passes a scene break that comes too early when the next one sits closer to the budget", () => {
    // 전환이 두 문단마다 있는 뼈대. 예산(세 구간)은 네 문단이라 첫 전환은 절반, 둘째 전환이 딱 맞다.
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
    // 첫 전환이 예산의 절반을 겨우 넘기고 다음 전환은 멀어서 첫 구간이 얇게 닫힌다. 남은 두 구간은
    // 남은 뼈대를 둘로 나눈 예산을 받아야 마지막 구간이 비대해지지 않는다.
    const skeleton = [
      paragraph(1),
      paragraph(2),
      "---",
      ...Array.from({ length: 10 }, (_, i) => paragraph(i + 3))
    ].join("\n\n")

    const [first, second, third] = lengthsOf(splitSkeletonIntoSections(skeleton, 3))

    expect(first).toBeLessThan(second as number)
    // 문단 경계는 예산을 넘긴 첫 자리에서 자르므로 한 문단만큼 넘칠 수 있고, 마지막 구간이 그만큼 얇다.
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

    // 비례 몫 9600·1200·1200 → 첫 구간 7000, 남는 2600을 1:1로 → 1200 + 1300 씩
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

// 장면 전환이 드문 긴 대목은 문단 경계에서 잘린다. 대화 한복판에서 자르면 앞 구간이 대화를 마저 써
// 다음 구간과 겹쳤다.
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
