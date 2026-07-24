import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { selectBibleFacts, selectInjectedFacts, selectValidBibleFacts } from '@storyboard/story-format';
import type { BibleFact, BibleFactStatus, BibleFactSubject, StoryBible } from '@storyboard/story-format';

const elia: BibleFactSubject = { kind: "character", id: "elia" }

function armFact(id: string, value: string, range: Partial<Pick<BibleFact, "validFrom" | "validUntil">>): BibleFact {
  return { id, subject: elia, key: "팔", value, status: "canon", ...range }
}

interface FactSpec {
  readonly id: string
  readonly subject?: BibleFactSubject
  readonly key?: string
  readonly value?: string
  readonly status?: BibleFactStatus
  readonly validFrom?: BibleFact["validFrom"]
  readonly validUntil?: BibleFact["validUntil"]
  readonly keywords?: string[]
}

function factOf(spec: FactSpec): BibleFact {
  const { id, subject = elia, key = id, value = id, status = "canon", validFrom, validUntil, keywords } = spec
  return {
    id,
    subject,
    key,
    value,
    status,
    ...(validFrom !== undefined ? { validFrom } : {}),
    ...(validUntil !== undefined ? { validUntil } : {}),
    ...(keywords !== undefined ? { keywords } : {})
  }
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

const crimsonEmpire: BibleFactSubject = { kind: "background", id: "crimson-empire" }
const jihoon: BibleFactSubject = { kind: "character", id: "jihoon" }

function injectedIds(
  bible: StoryBible,
  sceneText: string,
  sceneOrder: number,
  subjects: readonly BibleFactSubject[] = [elia],
  options?: { budget?: number }
): string[] {
  return selectInjectedFacts(bible, subjects, sceneText, sceneOrder, options).map((fact) => fact.id)
}

describe("selectInjectedFacts", () => {
  it("QAS-C5-01: activates a keyword fact whose subject is not a scene entity", () => {
    const keywordFact = factOf({ id: "ce", subject: crimsonEmpire, keywords: ["Crimson Empire"] })
    const bible = bibleOf([keywordFact])
    const sceneText = "the Crimson Empire rose"

    expect(injectedIds(bible, sceneText, 1, [elia])).toContain("ce")

    const entityOnly = bibleOf([factOf({ id: "ce", subject: crimsonEmpire })])
    expect(injectedIds(entityOnly, sceneText, 1, [elia])).not.toContain("ce")
  })

  it("QAS-C5-02: does not activate when no keyword appears and subject is absent", () => {
    const keywordFact = factOf({ id: "ce", subject: crimsonEmpire, keywords: ["Crimson Empire"] })
    const eliaFact = factOf({ id: "e1", subject: elia, key: "팔", value: "의수" })
    const bible = bibleOf([eliaFact, keywordFact])
    const sceneText = "a quiet village morning"

    const result = injectedIds(bible, sceneText, 1, [elia])

    expect(result).not.toContain("ce")
    expect(result).toEqual(selectIds(bible, 1, [elia]))
  })

  it("QAS-C5-03: a no-keyword fact still enters via the entity path regardless of scene text", () => {
    const bible = bibleOf([
      factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" }),
      factOf({ id: "e2", subject: elia, key: "키", value: "170cm", validFrom: 1 })
    ])
    const entityIds = selectValidBibleFacts(bible, [elia], 5).map((fact) => fact.id)

    for (const sceneText of ["", "no keyword here", "Crimson Empire"]) {
      expect(injectedIds(bible, sceneText, 5, [elia])).toEqual(entityIds)
    }
  })

  it("QAS-C5-04: a keyword fact respects time-validity at the scene order", () => {
    const futureFact = factOf({ id: "ce", subject: crimsonEmpire, keywords: ["empire"], validFrom: 5 })
    const bible = bibleOf([futureFact])
    const sceneText = "the empire endures"

    expect(injectedIds(bible, sceneText, 3, [elia])).not.toContain("ce")
    expect(injectedIds(bible, sceneText, 5, [elia])).toContain("ce")

    const inverted = bibleOf([
      factOf({ id: "inv", subject: crimsonEmpire, keywords: ["empire"], validFrom: 8, validUntil: 5 })
    ])
    for (const sceneOrder of [1, 5, 6, 8, 100]) {
      expect(injectedIds(inverted, sceneText, sceneOrder, [elia])).not.toContain("inv")
    }
  })

  it("QAS-C5-05: a fact on both paths appears once, in the entity prefix", () => {
    const dualFact = factOf({ id: "elia-kw", subject: elia, key: "출신", value: "제국", keywords: ["empire"] })
    const keywordOnly = factOf({ id: "ce", subject: crimsonEmpire, key: "통치", value: "깃발", keywords: ["empire"] })
    const bible = bibleOf([dualFact, keywordOnly])
    const sceneText = "the empire's banner"

    const ids = injectedIds(bible, sceneText, 1, [elia])

    expect(ids.filter((id) => id === "elia-kw")).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(["elia-kw", "ce"])
    expect(ids.indexOf("elia-kw")).toBeLessThan(ids.indexOf("ce"))
  })

  it("QAS-C5-06: ranks entity tier, then keyword score desc, then declaration index then id", () => {
    const entityFact = factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" })
    const score2 = factOf({ id: "k2", subject: crimsonEmpire, key: "a", keywords: ["empire", "crimson"] })
    const score1 = factOf({ id: "k1", subject: jihoon, key: "b", keywords: ["empire"] })
    const bible = bibleOf([entityFact, score2, score1])
    const sceneText = "the crimson empire"

    expect(injectedIds(bible, sceneText, 1, [elia], { budget: 100 })).toEqual(["e1", "k2", "k1"])

    const tieEarly = factOf({ id: "z-tie", subject: jihoon, key: "c", keywords: ["empire"] })
    const tieLate = factOf({ id: "a-tie", subject: jihoon, key: "d", keywords: ["empire"] })
    const tieBible = bibleOf([tieEarly, tieLate])

    expect(injectedIds(tieBible, "empire", 1, [elia])).toEqual(["z-tie", "a-tie"])
    expect(injectedIds(bibleOf([...tieBible.facts].reverse()), "empire", 1, [elia])).toEqual(["a-tie", "z-tie"])
  })

  it("QAS-C5-06b: scores distinct keywords, so duplicate aliases do not inflate rank", () => {
    const duplicated = factOf({ id: "dup", subject: crimsonEmpire, key: "a", keywords: ["Empire", "empire", "EMPIRE"] })
    const single = factOf({ id: "single", subject: jihoon, key: "b", keywords: ["empire", "crimson"] })
    const bible = bibleOf([duplicated, single])

    expect(injectedIds(bible, "the crimson empire", 1, [elia])).toEqual(["single", "dup"])
  })

  it("QAS-C5-07: a budget below the merged size keeps the top-budget prefix", () => {
    const bible = bibleOf([
      factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" }),
      factOf({ id: "k2", subject: crimsonEmpire, key: "a", keywords: ["empire", "crimson"] }),
      factOf({ id: "k1", subject: jihoon, key: "b", keywords: ["empire"] }),
      factOf({ id: "k0", subject: { kind: "background", id: "north" }, key: "c", keywords: ["north"] })
    ])
    const sceneText = "the crimson empire of the north"

    const full = injectedIds(bible, sceneText, 1, [elia])
    expect(full).toHaveLength(4)

    const capped = injectedIds(bible, sceneText, 1, [elia], { budget: 2 })
    expect(capped).toHaveLength(2)
    expect(capped).toEqual(full.slice(0, 2))
  })

  it("QAS-C5-08: omitting options and budget undefined both return the full merged set", () => {
    const bible = bibleOf([
      factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" }),
      factOf({ id: "k1", subject: crimsonEmpire, key: "a", keywords: ["empire"] }),
      factOf({ id: "k0", subject: jihoon, key: "b", keywords: ["empire"] })
    ])
    const sceneText = "the empire"

    const omitted = injectedIds(bible, sceneText, 1, [elia])
    const undefinedBudget = injectedIds(bible, sceneText, 1, [elia], { budget: undefined })

    expect(omitted).toHaveLength(3)
    expect(undefinedBudget).toEqual(omitted)
  })

  it("QAS-C5-09: floors and clamps the budget without throwing", () => {
    const bible = bibleOf([
      factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" }),
      factOf({ id: "k1", subject: crimsonEmpire, key: "a", keywords: ["empire"] }),
      factOf({ id: "k0", subject: jihoon, key: "b", keywords: ["empire"] })
    ])
    const sceneText = "the empire"

    expect(injectedIds(bible, sceneText, 1, [elia], { budget: 0 })).toEqual([])
    expect(injectedIds(bible, sceneText, 1, [elia], { budget: -1 })).toEqual([])
    expect(injectedIds(bible, sceneText, 1, [elia], { budget: 0.4 })).toEqual([])
    expect(injectedIds(bible, sceneText, 1, [elia], { budget: 2.9 })).toHaveLength(2)
  })

  it("QAS-C5-10: matches case-insensitively as a substring, never on blank text", () => {
    const bible = bibleOf([factOf({ id: "ce", subject: crimsonEmpire, keywords: ["Crimson Empire"] })])

    expect(injectedIds(bible, "the CRIMSON empire fell", 1, [elia])).toContain("ce")

    const empireFact = bibleOf([factOf({ id: "ce", subject: crimsonEmpire, keywords: ["empire"] })])
    expect(injectedIds(empireFact, "empires of old", 1, [elia])).toContain("ce")

    expect(injectedIds(bible, "", 1, [elia])).not.toContain("ce")
    expect(injectedIds(bible, "   ", 1, [elia])).not.toContain("ce")
  })

  it("QAS-C5-11: matches selectValidBibleFacts exactly for keyword-free bibles", () => {
    const subjectA: BibleFactSubject = { kind: "character", id: "elia" }
    const subjectB: BibleFactSubject = { kind: "background", id: "school" }
    const bibles: StoryBible[] = [
      bibleOf([
        factOf({ id: "a1", subject: subjectA, key: "눈", value: "녹색" }),
        factOf({ id: "a2", subject: subjectA, key: "팔", value: "멀쩡함", validUntil: 3 }),
        factOf({ id: "a3", subject: subjectA, key: "팔", value: "의수", validFrom: 4 }),
        factOf({ id: "b1", subject: subjectB, key: "위치", value: "외곽" })
      ]),
      bibleOf([
        factOf({ id: "c1", subject: subjectB, key: "분위기", value: "고요", validFrom: 10, validUntil: 40 }),
        factOf({ id: "c2", subject: subjectA, key: "직업", value: "기사" }),
        factOf({ id: "c3", subject: subjectA, key: "직업", value: "여왕", validFrom: 30 })
      ])
    ]
    const subjectSets: BibleFactSubject[][] = [[subjectA], [subjectA, subjectB], [subjectB]]
    const sceneTexts = ["", "empire and crimson and school", "무작위 텍스트 elia school"]

    for (const bible of bibles) {
      for (const subjects of subjectSets) {
        for (const sceneOrder of [1, 25, 50]) {
          for (const sceneText of sceneTexts) {
            const injected = selectInjectedFacts(bible, subjects, sceneText, sceneOrder).map((fact) => fact.id)
            const valid = selectValidBibleFacts(bible, subjects, sceneOrder).map((fact) => fact.id)
            expect(injected).toEqual(valid)
          }
        }
      }
    }
  })

  it("QAS-C5-13: source stays vscode-free and AI-free, and calls are deterministic", () => {
    const sourcePath = fileURLToPath(new URL("../../../../../packages/story-format/src/bible.ts", import.meta.url))
    const source = readFileSync(sourcePath, "utf8")

    expect(source.length).toBeGreaterThan(0)
    expect(source).not.toMatch(/from\s+["']vscode["']/)
    expect(source).not.toMatch(/services\/ai/)
    expect(source).not.toMatch(/from\s+["']https?:\/\//)

    const bible = bibleOf([
      factOf({ id: "e1", subject: elia, key: "눈", value: "녹색" }),
      factOf({ id: "k1", subject: crimsonEmpire, key: "a", keywords: ["empire", "crimson"] }),
      factOf({ id: "k0", subject: jihoon, key: "b", keywords: ["empire"] })
    ])
    const sceneText = "the crimson empire"

    const first = selectInjectedFacts(bible, [elia], sceneText, 1, { budget: 2 })
    const second = selectInjectedFacts(bible, [elia], sceneText, 1, { budget: 2 })

    expect(first).toEqual(second)
  })

  it("QAS-C5-14: handles 5000 facts x 5 keywords within a generous bound", () => {
    const facts: BibleFact[] = []
    for (let index = 0; index < 5000; index++) {
      facts.push(
        factOf({
          id: `f${index}`,
          subject: { kind: "background", id: `bg-${index}` },
          key: `k${index}`,
          keywords: [`alpha${index}`, `beta${index}`, `gamma${index}`, `delta${index}`, "empire"]
        })
      )
    }
    const bible = bibleOf(facts)
    const sceneText = "the empire spans the whole world"

    const start = performance.now()
    const result = selectInjectedFacts(bible, [elia], sceneText, 1, { budget: 50 })
    const elapsed = performance.now() - start

    expect(result).toHaveLength(50)
    expect(elapsed).toBeLessThan(200)
  })
})
