import { describe, expect, it } from "vitest"

import {
  selectBibleFacts,
  selectValidBibleFacts,
  type BibleFact,
  type BibleFactSubject,
  type StoryBible
} from "@/shared/bible"

const elia: BibleFactSubject = { kind: "character", id: "elia" }

function armFact(id: string, value: string, range: Partial<Pick<BibleFact, "validFrom" | "validUntil">>): BibleFact {
  return { id, subject: elia, key: "팔", value, status: "canon", ...range }
}

function bibleOf(facts: BibleFact[]): StoryBible {
  return { version: "1.0.0", facts }
}

function selectIds(bible: StoryBible, sceneOrder: number, subjects: readonly BibleFactSubject[] = [elia]): string[] {
  return selectValidBibleFacts(bible, subjects, sceneOrder).map((fact) => fact.id)
}

describe("selectValidBibleFacts — QAS-1 version selection at scene order", () => {
  const bible = bibleOf([
    armFact("A", "멀쩡함", { validUntil: 3 }),
    armFact("B", "의수", { validFrom: 4 })
  ])

  it("selects the earlier version for scenes before the cutover", () => {
    expect(selectIds(bible, 1)).toEqual(["A"])
    expect(selectIds(bible, 2)).toEqual(["A"])
  })

  it("selects the later version for scenes at and after the cutover", () => {
    expect(selectIds(bible, 4)).toEqual(["B"])
    expect(selectIds(bible, 5)).toEqual(["B"])
    expect(selectIds(bible, 100)).toEqual(["B"])
  })

  it("treats both bounds as inclusive at the boundary", () => {
    expect(selectIds(bible, 3)).toEqual(["A"])
    expect(selectIds(bible, 4)).toEqual(["B"])
  })

  it("contributes nothing when no version is valid at the scene", () => {
    const futureOnly = bibleOf([armFact("future", "여왕", { validFrom: 5 })])

    expect(selectIds(futureOnly, 2)).toEqual([])
  })
})

describe("selectValidBibleFacts — QAS-2 latest-wins on overlap", () => {
  it("returns the version with the higher validFrom on overlap", () => {
    const facts = [
      armFact("A", "초기", { validFrom: 1, validUntil: 10 }),
      armFact("B", "후기", { validFrom: 5 })
    ]

    expect(selectIds(bibleOf(facts), 6)).toEqual(["B"])
  })

  it("decides by validFrom before declaration order (reversing input keeps the winner)", () => {
    const facts = [
      armFact("A", "초기", { validFrom: 1, validUntil: 10 }),
      armFact("B", "후기", { validFrom: 5 })
    ]

    expect(selectIds(bibleOf([...facts].reverse()), 6)).toEqual(["B"])
  })

  it("falls back to later declaration order when validFrom and validUntil tie", () => {
    const facts = [
      armFact("A", "먼저", { validFrom: 1, validUntil: 10 }),
      armFact("B", "나중", { validFrom: 1, validUntil: 10 })
    ]

    expect(selectIds(bibleOf(facts), 6)).toEqual(["B"])
    expect(selectIds(bibleOf([...facts].reverse()), 6)).toEqual(["A"])
  })
})

describe("selectValidBibleFacts — QAS-4 open-ended ranges", () => {
  it("includes a from-only fact at and after its start, excludes before", () => {
    const bible = bibleOf([armFact("from", "의수", { validFrom: 5 })])

    expect(selectIds(bible, 4)).toEqual([])
    expect(selectIds(bible, 5)).toEqual(["from"])
    expect(selectIds(bible, 100)).toEqual(["from"])
  })

  it("includes an until-only fact at and before its end, excludes after", () => {
    const bible = bibleOf([armFact("until", "멀쩡함", { validUntil: 5 })])

    expect(selectIds(bible, 1)).toEqual(["until"])
    expect(selectIds(bible, 5)).toEqual(["until"])
    expect(selectIds(bible, 6)).toEqual([])
  })

  it("includes a range-less fact for every scene", () => {
    const bible = bibleOf([armFact("always", "멀쩡함", {})])

    expect(selectIds(bible, 1)).toEqual(["always"])
    expect(selectIds(bible, 100)).toEqual(["always"])
  })
})

describe("selectValidBibleFacts — QAS-6a inverted range", () => {
  it("never matches and never throws for an inverted range", () => {
    const bible = bibleOf([armFact("inverted", "의수", { validFrom: 8, validUntil: 5 })])

    for (const sceneOrder of [1, 6, 10, 100]) {
      expect(selectIds(bible, sceneOrder)).toEqual([])
    }
  })
})

describe("selectValidBibleFacts — QAS-3b legacy parity", () => {
  const legacy: StoryBible = {
    version: "1.0.0",
    facts: [
      { id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" },
      { id: "f2", subject: { kind: "character", id: "jihoon" }, key: "키", value: "180cm", status: "canon" },
      { id: "f3", subject: { kind: "character", id: "elia" }, key: "취미", value: "검술", status: "candidate" },
      { id: "f4", subject: { kind: "background", id: "school" }, key: "위치", value: "도시 외곽", status: "canon" }
    ]
  }
  const subjectSets: BibleFactSubject[][] = [
    [{ kind: "character", id: "elia" }],
    [
      { kind: "character", id: "jihoon" },
      { kind: "background", id: "school" }
    ]
  ]

  it("matches selectBibleFacts by id for every subject set and scene order", () => {
    for (const subjects of subjectSets) {
      const legacyIds = selectBibleFacts(legacy, subjects).map((fact) => fact.id)

      for (const sceneOrder of [1, 25, 50]) {
        expect(selectValidBibleFacts(legacy, subjects, sceneOrder).map((fact) => fact.id)).toEqual(legacyIds)
      }
    }
  })
})

describe("selectValidBibleFacts — filtering rules", () => {
  it("excludes candidate-status facts even when valid at the scene", () => {
    const bible = bibleOf([{ ...armFact("cand", "의수", { validFrom: 1 }), status: "candidate" }])

    expect(selectIds(bible, 5)).toEqual([])
  })

  it("excludes facts for non-requested subjects", () => {
    const bible = bibleOf([
      { id: "j1", subject: { kind: "character", id: "jihoon" }, key: "키", value: "180cm", status: "canon" }
    ])

    expect(selectIds(bible, 5)).toEqual([])
  })

  it("returns an empty array when no subjects are requested", () => {
    const bible = bibleOf([armFact("A", "멀쩡함", {})])

    expect(selectValidBibleFacts(bible, [], 5)).toEqual([])
  })
})

describe("selectValidBibleFacts — string and numeric bounds resolve identically", () => {
  it("treats a NN-slug validFrom like its numeric order", () => {
    const stringBound = bibleOf([armFact("stem", "의수", { validFrom: "04-the-fall" })])
    const numericBound = bibleOf([armFact("num", "의수", { validFrom: 4 })])

    expect(selectIds(stringBound, 3)).toEqual([])
    expect(selectIds(numericBound, 3)).toEqual([])
    expect(selectIds(stringBound, 4)).toEqual(["stem"])
    expect(selectIds(numericBound, 4)).toEqual(["num"])
  })
})
