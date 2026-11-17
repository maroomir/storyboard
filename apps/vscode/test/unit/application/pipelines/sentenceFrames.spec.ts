import { describe, expect, it } from "vitest"

import {
  countNarrationSentenceFrames,
  describeSentenceFrameBudget,
  findOverusedSentenceFrames,
  planSectionSentenceFrameBudgets,
  validateExpandedSection
} from "@storyboard/story-engine"
import { defaultCraftContract } from "@storyboard/story-model"

describe("countNarrationSentenceFrames", () => {
  it("counts the frames in narration and leaves dialogue out (#188)", () => {
    const text: string =
      "기쁜 게 아니다. 그저 당연한 결과일 뿐이다. “괜히 그러는 게 아니야.” 나는 괜히 컵을 들었다."

    expect(countNarrationSentenceFrames(text, ["게 아니", "뿐이", "괜히", "그저", "결코"])).toEqual([
      { frame: "게 아니", count: 1 },
      { frame: "뿐이", count: 1 },
      { frame: "괜히", count: 1 },
      { frame: "그저", count: 1 }
    ])
  })
})

describe("planSectionSentenceFrameBudgets", () => {
  it("gives each section its share of the scene rate, at least once", () => {
    const budgets = planSectionSentenceFrameBudgets({
      frames: ["괜히"],
      framesPer10kChars: 2,
      sectionTargetLengths: [3000, 20000]
    })

    expect(budgets.map((budget) => budget?.limit)).toEqual([1, 4])
  })

  it("plans nothing when no frame is listed", () => {
    expect(
      planSectionSentenceFrameBudgets({ frames: [], framesPer10kChars: 2, sectionTargetLengths: [3000] })
    ).toEqual([undefined])
  })

  it("ships a default frame list in the craft contract", () => {
    expect(defaultCraftContract.sentenceFrames).toContain("괜히")
    expect(defaultCraftContract.sentenceFramesPer10kChars).toBeGreaterThan(0)
  })
})

describe("findOverusedSentenceFrames", () => {
  it("allows as many as the skeleton piece already has", () => {
    const budget = { frames: ["괜히"], limit: 1 }

    expect(
      findOverusedSentenceFrames({ expanded: "괜히 웃었다. 괜히 울었다.", section: "괜히 웃었다. 괜히 울었다.", budget })
    ).toEqual([])
    expect(findOverusedSentenceFrames({ expanded: "괜히 웃었다. 괜히 울었다.", section: "웃었다.", budget })).toEqual([
      { frame: "괜히", count: 2 }
    ])
  })

  it("describes the budget for the expansion prompt", () => {
    expect(describeSentenceFrameBudget({ frames: ["괜히", "그저"], limit: 2 })).toBe(
      "서술에서 «괜히»·«그저» 같은 틀은 각각 2번까지"
    )
  })
})

describe("validateExpandedSection sentence frames", () => {
  it("flags a section that repeats a frame past its share", () => {
    const violations = validateExpandedSection({
      skeleton: "나는 컵을 들었다.",
      section: "나는 컵을 들었다.",
      expanded: "나는 괜히 컵을 들었다. 괜히 창밖을 봤다. 괜히 웃었다.",
      characters: [],
      targetLength: 10,
      sentenceFrameBudget: { frames: ["괜히"], limit: 1 }
    })

    const frameViolation = violations.find((violation) => violation.kind === "sentence-frame")
    expect(frameViolation?.detail).toContain("«괜히» 3번")
  })
})
