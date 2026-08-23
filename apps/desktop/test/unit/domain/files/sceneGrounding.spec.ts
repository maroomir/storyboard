import { describe, expect, it } from "vitest"

import {
  applySceneGrounding,
  defaultCraftContract,
  isSceneGroundingComplete,
  mergeSceneGrounding,
  missingSceneGroundingFields,
  parseScene,
  resolveCraftContract
} from '@storyboard/story-format';

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

describe("scene grounding frontmatter write", () => {
  it("appends a grounding block while preserving other keys byte-for-byte", () => {
    const scene = ["---", "title: 프롤로그", "characters: [elia, jihoon]", "---", "본문이다.", ""].join(
      "\n"
    )

    const written = applySceneGrounding(scene, { incident: "면접 탈락", place: "옥탑방" })

    expect(written).toBe(
      [
        "---",
        "title: 프롤로그",
        "characters: [elia, jihoon]",
        "grounding:",
        "  incident: 면접 탈락",
        "  place: 옥탑방",
        "---",
        "본문이다.",
        ""
      ].join("\n")
    )
    expect(parseScene(written, "01-prologue.txt").frontmatter.grounding).toEqual({
      incident: "면접 탈락",
      place: "옥탑방"
    })
  })

  it("replaces an existing grounding block without touching later keys", () => {
    const scene = [
      "---",
      "title: 프롤로그",
      "grounding:",
      "  incident: 낡은 사건",
      "  place: 낡은 장소",
      "mood: 시작",
      "---",
      "본문이다.",
      ""
    ].join("\n")

    const written = applySceneGrounding(scene, { incident: "새 사건" })

    expect(written).toBe(
      [
        "---",
        "title: 프롤로그",
        "grounding:",
        "  incident: 새 사건",
        "mood: 시작",
        "---",
        "본문이다.",
        ""
      ].join("\n")
    )
  })

  it("creates a frontmatter block when the scene has none", () => {
    const written = applySceneGrounding("가사만 있는 본문\n", { incident: "면접 탈락" })

    expect(written).toBe(["---", "grounding:", "  incident: 면접 탈락", "---", "가사만 있는 본문", ""].join("\n"))
    expect(parseScene(written, "01-prologue.txt").body).toBe("가사만 있는 본문\n")
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
