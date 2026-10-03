import { describe, expect, it } from "vitest"

import type { DraftCritiqueIssue } from '@storyboard/story-model';
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  resolveAgent,
  routeReviewIssues,
  type ReviewIssue
} from "@storyboard/story-engine"

const characters = [
  { id: "elia", name: "엘리아", aliases: ["엘리"] },
  { id: "jihoon", name: "지훈" }
]

describe("resolveAgent", () => {
  it("maps categories to agents deterministically", () => {
    expect(resolveAgent("voice")).toBe("persona")
    expect(resolveAgent("continuity")).toBe("canon")
    expect(resolveAgent("repetition")).toBe("narrator")
    expect(resolveAgent("purpose")).toBe("narrator")
    expect(resolveAgent("grammar")).toBeUndefined()
  })
})

describe("adaptCritiqueIssues", () => {
  it("routes voice issues to persona and resolves cardId from the excerpt", () => {
    const issues: DraftCritiqueIssue[] = [
      { category: "voice", severity: "high", excerpt: "엘리아는 차분하게 말했다", comment: "보이스 흔들림" }
    ]

    const [issue] = adaptCritiqueIssues(issues, characters)

    expect(issue?.target).toEqual({ agent: "persona", cardId: "elia" })
    expect(issue?.category).toBe("voice")
    expect(issue?.note).toBe("보이스 흔들림")
  })

  it("resolves cardId from an alias in the excerpt", () => {
    const issues: DraftCritiqueIssue[] = [
      { category: "voice", severity: "low", excerpt: "엘리, 그건 아니야", comment: "말투" }
    ]

    const [issue] = adaptCritiqueIssues(issues, characters)

    expect(issue?.target).toEqual({ agent: "persona", cardId: "elia" })
  })

  it("leaves cardId empty when the excerpt matches no character", () => {
    const issues: DraftCritiqueIssue[] = [
      { category: "voice", severity: "low", excerpt: "낯선 목소리", comment: "말투" }
    ]

    const [issue] = adaptCritiqueIssues(issues, characters)

    expect(issue?.target).toEqual({ agent: "persona" })
    expect(issue?.target?.cardId).toBeUndefined()
  })

  it("leaves cardId empty when the excerpt matches two characters", () => {
    const issues: DraftCritiqueIssue[] = [
      { category: "voice", severity: "low", excerpt: "엘리아와 지훈이 다툰다", comment: "말투" }
    ]

    const [issue] = adaptCritiqueIssues(issues, characters)

    expect(issue?.target?.cardId).toBeUndefined()
  })

  it("routes purpose and repetition issues to narrator", () => {
    const issues: DraftCritiqueIssue[] = [
      { category: "purpose", severity: "high", comment: "장면 목적 미달" },
      { category: "repetition", severity: "low", comment: "표현 반복" }
    ]

    const [purpose, repetition] = adaptCritiqueIssues(issues, characters)

    expect(purpose?.target).toEqual({ agent: "narrator" })
    expect(repetition?.target).toEqual({ agent: "narrator" })
  })
})

describe("adaptContinuityIssues", () => {
  it("routes continuity issues to the canon agent", () => {
    const [issue] = adaptContinuityIssues([
      { original: "그녀의 눈은 파랗다", reason: "캐논은 녹색", severity: "high" }
    ])

    expect(issue?.target).toEqual({ agent: "canon" })
    expect(issue?.category).toBe("continuity")
    expect(issue?.note).toContain("녹색")
  })
})

describe("routeReviewIssues", () => {
  it("returns no groups and no global issues for an empty list", () => {
    const routing = routeReviewIssues([])

    expect(routing.groups).toEqual([])
    expect(routing.global).toEqual([])
  })

  it("groups issues by agent in canon → persona → narrator order", () => {
    const issues: ReviewIssue[] = [
      { category: "repetition", severity: "low", target: { agent: "narrator" }, note: "반복" },
      { category: "voice", severity: "high", target: { agent: "persona", cardId: "elia" }, note: "보이스" },
      { category: "continuity", severity: "high", target: { agent: "canon" }, note: "설정" }
    ]

    const routing = routeReviewIssues(issues)

    expect(routing.groups.map((group) => group.agent)).toEqual(["canon", "persona", "narrator"])
    expect(routing.global).toEqual([])
  })

  it("collects best-effort cardIds for a persona group", () => {
    const issues: ReviewIssue[] = [
      { category: "voice", severity: "high", target: { agent: "persona", cardId: "elia" }, note: "a" },
      { category: "voice", severity: "low", target: { agent: "persona" }, note: "b" },
      { category: "voice", severity: "low", target: { agent: "persona", cardId: "jihoon" }, note: "c" }
    ]

    const personaGroup = routeReviewIssues(issues).groups.find((group) => group.agent === "persona")

    expect(personaGroup?.cardIds).toEqual(["elia", "jihoon"])
  })

  it("treats untargeted issues as global fallback", () => {
    const issues: ReviewIssue[] = [
      { category: "grammar", severity: "low", note: "오탈자" },
      { category: "voice", severity: "high", target: { agent: "persona", cardId: "elia" }, note: "보이스" }
    ]

    const routing = routeReviewIssues(issues)

    expect(routing.global.map((issue) => issue.note)).toEqual(["오탈자"])
    expect(routing.groups.map((group) => group.agent)).toEqual(["persona"])
  })
})

describe("buildScopedInstructions", () => {
  it("scopes persona instructions to character voice and dialogue", () => {
    const instructions = buildScopedInstructions({
      agent: "persona",
      cardIds: ["elia"],
      issues: [{ category: "voice", severity: "high", target: { agent: "persona", cardId: "elia" }, note: "보이스 흔들림" }]
    })

    expect(instructions.join("\n")).toContain("보이스 흔들림")
    expect(instructions.some((line) => line.includes("대사") || line.includes("보이스"))).toBe(true)
  })

  it("resolves persona cardIds to display names when a resolver is provided", () => {
    const instructions = buildScopedInstructions(
      {
        agent: "persona",
        cardIds: ["elia"],
        issues: [{ category: "voice", severity: "high", target: { agent: "persona", cardId: "elia" }, note: "보이스" }]
      },
      (cardId) => (cardId === "elia" ? "엘리아" : undefined)
    )

    expect(instructions.join("\n")).toContain("엘리아")
    expect(instructions.join("\n")).not.toContain("elia")
  })

  it("scopes narrator instructions to prose and repetition", () => {
    const instructions = buildScopedInstructions({
      agent: "narrator",
      cardIds: [],
      issues: [{ category: "repetition", severity: "low", target: { agent: "narrator" }, note: "표현 반복" }]
    })

    expect(instructions.join("\n")).toContain("표현 반복")
  })

  it("scopes canon instructions to continuity", () => {
    const instructions = buildScopedInstructions({
      agent: "canon",
      cardIds: [],
      issues: [{ category: "continuity", severity: "high", target: { agent: "canon" }, note: "설정 모순" }]
    })

    expect(instructions.join("\n")).toContain("설정 모순")
  })
})
