import { describe, expect, it } from "vitest"

import {
  findSeamRepeat,
  findSeamRepeatViolations,
  resolveSceneGenerationTuning,
  validateExpandedSection
} from "@storyboard/story-engine"

const options = { windowChars: 400, minimumRunWords: 3, ignoredPhrases: [] as string[] }
const walkedHome: string =
  "성재가 반대 방향으로 뛰어갔다. 나는 혼자 집으로 향했다. 아파트 로비까지 걸어서 콜라 반 병 거리, 늘 그렇듯 짧은 길이었다."
const walksHomeAgain: string =
  "⟪시각: 오후 / 장소: 콘도 / 있는 사람: 나⟫\n집으로 돌아가는 길이 평소보다 길게 느껴졌다. 10페소 콜라 반 병 거리면 다 왔다는 신호인데, 오늘은 발이 무거웠다."

describe("findSeamRepeat", () => {
  it("finds a seam that narrates the same walk again (#188)", () => {
    expect(findSeamRepeat(walkedHome, walksHomeAgain, options)).toBe("콜라 반 병")
  })

  it("lets a seam that moves on pass", () => {
    expect(
      findSeamRepeat(walkedHome, "초인종을 눌렀다. 문을 연 사람은 엄마가 아니었다.", options)
    ).toBeUndefined()
  })

  it("leaves repeated dialogue and ignored names out", () => {
    expect(
      findSeamRepeat("“말 안 해주면 더 궁금하잖아.” 나는 걸었다.", "“말 안 해주면 더 궁금하잖아.” 톡이 왔다.", options)
    ).toBeUndefined()
    expect(
      findSeamRepeat("세기의 철학자 조만재는 웃었다.", "세기의 철학자 조만재는 울었다.", {
        ...options,
        ignoredPhrases: ["세기의 철학자", "조만재"]
      })
    ).toBeUndefined()
  })
})

describe("findSeamRepeatViolations", () => {
  const tuning = resolveSceneGenerationTuning(undefined)

  it("reports the repeat as a repeat of the previous part", () => {
    const [violation] = findSeamRepeatViolations({ previousText: walkedHome, text: walksHomeAgain, characters: [], tuning })

    expect(violation?.kind).toBe("repeats-previous")
    expect(violation?.detail).toContain("«콜라 반 병»")
  })

  it("lets an expansion keep a repeat its skeleton piece already had", () => {
    expect(
      validateExpandedSection({
        skeleton: walksHomeAgain,
        section: walksHomeAgain,
        expanded: walksHomeAgain,
        previousSection: walkedHome,
        characters: [],
        targetLength: 10
      }).filter((violation) => violation.detail.includes("이음매"))
    ).toEqual([])
  })
})
