import { describe, expect, it } from "vitest"

import {
  applySceneGrounding,
  defaultCraftContract,
  isSceneGroundingComplete,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  parseScene,
  resolveCraftContract,
  resolveSceneTargetLength
} from '@storyboard/story-format';
import { buildStyleDirective, narrativeStyleLines } from '@storyboard/story-ai';

const fullGrounding = {
  incident: "임용시험 최종 면접에서 떨어졌다",
  place: "서하의 옥탑방 현관문 앞",
  relation: "반년째 계단에서 인사만 하던 아랫집 이웃",
  time: "11월 말 자정 무렵"
}

describe("scene grounding fields", () => {
  it("reports missing fields and completeness", () => {
    expect(missingSceneGroundingFields(undefined)).toEqual(["incident", "place", "relation", "time"])
    expect(missingSceneGroundingFields({ incident: "면접 탈락", place: "  " })).toEqual([
      "place",
      "relation",
      "time"
    ])
    expect(isSceneGroundingComplete(fullGrounding)).toBe(true)
    expect(isSceneGroundingComplete({ incident: "면접 탈락" })).toBe(false)
  })

  it("keeps user values and only fills empty fields from the proposal", () => {
    const merged = mergeSceneGrounding(
      { incident: "사용자가 적은 사건", place: "   " },
      { incident: "AI가 제안한 사건", place: "AI가 제안한 장소", time: "AI가 제안한 시점" }
    )

    expect(merged).toEqual({
      incident: "사용자가 적은 사건",
      place: "AI가 제안한 장소",
      time: "AI가 제안한 시점"
    })
  })
})

describe("scene grounding card write", () => {
  it("adds a grounding block at its canonical position", () => {
    const scene = [
      "type: scene",
      "id: 01-prologue",
      "title: 프롤로그",
      "characters:",
      "  - elia",
      "  - jihoon",
      "summary: 본문이다.",
      ""
    ].join("\n")

    const written = applySceneGrounding(scene, { incident: "면접 탈락", place: "옥탑방" })

    expect(written).toBe(
      [
        "type: scene",
        "id: 01-prologue",
        "title: 프롤로그",
        "characters:",
        "  - elia",
        "  - jihoon",
        "grounding:",
        "  incident: 면접 탈락",
        "  place: 옥탑방",
        "summary: 본문이다.",
        ""
      ].join("\n")
    )
    expect(parseScene(written, "01-prologue.card").frontmatter.grounding).toEqual({
      incident: "면접 탈락",
      place: "옥탑방"
    })
  })

  it("replaces an existing grounding block without touching other keys", () => {
    const scene = [
      "type: scene",
      "id: 01-prologue",
      "title: 프롤로그",
      "mood: 시작",
      "grounding:",
      "  incident: 낡은 사건",
      "  place: 낡은 장소",
      "summary: 본문이다.",
      ""
    ].join("\n")

    const written = applySceneGrounding(scene, { incident: "새 사건" })

    expect(written).toBe(
      [
        "type: scene",
        "id: 01-prologue",
        "title: 프롤로그",
        "mood: 시작",
        "grounding:",
        "  incident: 새 사건",
        "summary: 본문이다.",
        ""
      ].join("\n")
    )
  })

  it("rejects a scene that is not a card", () => {
    expect(() => applySceneGrounding("가사만 있는 본문\n", { incident: "면접 탈락" })).toThrow()
  })
})

describe("craft contract", () => {
  it("returns built-in defaults when the project sets nothing", () => {
    expect(resolveCraftContract(undefined)).toEqual(defaultCraftContract)
  })

  it("overrides only the provided fields", () => {
    const resolved = resolveCraftContract({ motifRepeatLimit: 5, banTelling: false })

    expect(resolved.motifRepeatLimit).toBe(5)
    expect(resolved.banTelling).toBe(false)
    expect(resolved.stockGestureBlacklist).toEqual(defaultCraftContract.stockGestureBlacklist)
    expect(resolved.requireCharacterInterior).toBe(true)
  })
})

describe("scene length budget", () => {
  const sceneSeed = "가".repeat(1000)

  it("keeps an explicit target and the in-body marker ahead of the derived one", () => {
    expect(resolveSceneTargetLength(2400, sceneSeed, 12)).toBe(2400)
    expect(resolveSceneTargetLength(undefined, "[목표 분량]\n약 3,000자", 12)).toBe(3000)
  })

  it("derives a budget from the scene seed length when nothing is set", () => {
    expect(resolveSceneTargetLength(undefined, sceneSeed, 12)).toBe(12000)
  })

  it("clamps the derived budget and honours a disabled multiplier", () => {
    expect(resolveSceneTargetLength(undefined, "짧은 씬", 12)).toBe(2000)
    expect(resolveSceneTargetLength(undefined, "가".repeat(9000), 12)).toBe(20000)
    expect(resolveSceneTargetLength(undefined, sceneSeed, 0)).toBeUndefined()
    expect(resolveSceneTargetLength(undefined, sceneSeed)).toBeUndefined()
  })

  // 이 경로가 끊기면 목표 분량 없는 씬이 다시 무한정 길어진다.
  it("puts the derived budget into the generation prompt lines", () => {
    const directive = buildStyleDirective(undefined, undefined, undefined, sceneSeed)

    expect(directive?.targetWordCount).toBe(12000)
    expect(narrativeStyleLines(directive).some((line) => line.includes("12,000자"))).toBe(true)
  })

  it("adds no length line when the scene body is not supplied", () => {
    expect(buildStyleDirective(undefined, undefined, undefined)).toBeUndefined()
  })
})
