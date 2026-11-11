import { describe, expect, it } from "vitest"

import {
  findStatementsOutsideKind,
  mergeStatements,
  statementListSchema,
  statementSchema,
  storyStateStatementSchema,
  type Statement,
} from "@storyboard/story-model"

const elia = "3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44"
const sera = "7b1d2e90-4c3a-4f1b-8d2e-5a6b7c8d9e0f"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"

const studio = { origin: "studio", session: "8f3a" } as const
const interview = { origin: "interview", session: "91c0" } as const
const author = { origin: "author", command: "card set" } as const

describe("statement schema", () => {
  it("reads the statements the design shows", () => {
    const statements = statementListSchema.parse([
      { facet: "traits", value: "낯선 자리에서 먼저 말을 건다", source: studio },
      { facet: "relation", about: sera, value: "소꿉친구, 지금은 데면데면", source: studio },
      {
        facet: "fact",
        key: "비밀",
        value: "마법을 쓸 수 있다",
        revealFrom: rooftop,
        knownBy: [elia],
        keywords: ["마법"],
        source: author,
      },
    ])

    expect(statements).toHaveLength(3)
  })

  it("refuses an unknown facet, a missing about and a field outside the shape", () => {
    expect(statementSchema.safeParse({ facet: "mood", value: "서늘함", source: studio }).success).toBe(false)
    expect(statementSchema.safeParse({ facet: "speech", value: "반말", source: interview }).success).toBe(false)
    expect(statementSchema.safeParse({ facet: "traits", value: "x", id: "a", source: studio }).success).toBe(false)
  })

  it("keeps keywords to facts and references to uuids", () => {
    expect(statementSchema.safeParse({ facet: "traits", value: "x", keywords: ["y"], source: studio }).success).toBe(false)
    expect(statementSchema.safeParse({ facet: "fact", value: "x", knownBy: ["elia"], source: studio }).success).toBe(false)
    expect(statementSchema.safeParse({ facet: "traits", value: "x", key: "y", source: studio }).success).toBe(false)
  })

  it("names the statements a kind may not carry", () => {
    const statements: Statement[] = [
      { facet: "traits", value: "x", source: studio },
      { facet: "layout", value: "y", source: studio },
    ]

    expect(findStatementsOutsideKind("character", statements)).toEqual([{ index: 1, facet: "layout" }])
  })

  it("reads the story state vocabulary with its witnesses", () => {
    expect(
      storyStateStatementSchema.parse({ facet: "relationShift", about: sera, value: "회피", knownBy: [elia] }),
    ).toMatchObject({ facet: "relationShift" })
    expect(storyStateStatementSchema.safeParse({ facet: "traits", value: "x" }).success).toBe(false)
    expect(storyStateStatementSchema.safeParse({ facet: "reveal", about: sera, value: "x" }).success).toBe(false)
  })
})

describe("statement merge", () => {
  it("replaces the one line of a single-valued slot and appends to a list", () => {
    const current: Statement[] = [
      { facet: "arc", value: "도망친다", source: studio },
      { facet: "traits", value: "먼저 말을 건다", source: studio },
    ]
    const result = mergeStatements(current, [
      { facet: "arc", value: "거절을 받아들인다", source: interview },
      { facet: "traits", value: "뒤에서 앓는다", source: interview },
      { facet: "traits", value: "먼저, 말을 건다!", source: interview },
    ])

    expect(result.statements.map((statement) => statement.value)).toEqual([
      "거절을 받아들인다",
      "먼저 말을 건다",
      "뒤에서 앓는다",
    ])
    expect(result.replaced).toHaveLength(1)
    expect(result.added).toHaveLength(1)
    expect(result.unchanged).toHaveLength(1)
  })

  it("never lets a learned line replace the author's", () => {
    const current: Statement[] = [{ facet: "fact", key: "비밀", value: "마법을 쓸 수 있다", source: author }]
    const result = mergeStatements(current, [{ facet: "fact", key: "비밀", value: "마법을 못 쓴다", source: studio }])

    expect(result.statements).toEqual(current)
    expect(result.heldByAuthor).toHaveLength(1)
  })

  it("lets the author replace any line and take over an equal one", () => {
    const current: Statement[] = [{ facet: "desire", value: "인정받고 싶다", source: studio }]
    const result = mergeStatements(current, [{ facet: "desire", value: "인정받고 싶다", source: author }])

    expect(result.statements).toEqual([{ facet: "desire", value: "인정받고 싶다", source: author }])
    expect(result.replaced).toHaveLength(1)
  })

  it("keeps one relation per partner and lets facts without a key accumulate", () => {
    const current: Statement[] = [
      { facet: "relation", about: sera, value: "소꿉친구", source: studio },
      { facet: "fact", value: "학교 근처에 산다", source: studio },
    ]
    const result = mergeStatements(current, [
      { facet: "relation", about: sera, value: "데면데면", source: studio },
      { facet: "relation", about: elia, value: "자기 자신", source: studio },
      { facet: "fact", value: "고양이를 키운다", source: studio },
    ])

    expect(result.statements).toHaveLength(4)
    expect(result.replaced.map((statement) => statement.value)).toEqual(["데면데면"])
  })

  it("replaces a line whose witnesses changed", () => {
    const current: Statement[] = [{ facet: "fact", key: "비밀", value: "x", knownBy: [elia], source: studio }]
    const result = mergeStatements(current, [
      { facet: "fact", key: "비밀", value: "x", knownBy: [elia, sera], source: studio },
    ])

    expect(result.replaced).toHaveLength(1)
  })
})
