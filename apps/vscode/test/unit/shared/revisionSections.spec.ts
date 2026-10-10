import { describe, expect, it, vi } from "vitest"

import { AiProviderError, type ContinuityIssueLike, type DraftCritiqueIssue } from '@storyboard/story-model';
import {
  joinDraftSections,
  locateQuoteSection,
  planSectionRevisions,
  replaceSectionText,
  runReviseLoop,
  splitDraftSections
} from "@storyboard/story-engine"

const body = [
  "아침 식탁에서 만재는 백과사전을 펼쳤다. 엄마가 손뼉을 짝 쳤다.",
  "---",
  "",
  "교문을 나서자 은하가 기다리고 있었다.",
  "---",
  "",
  "옥상에는 바베큐 연기가 자욱했다."
].join("\n")

describe("splitDraftSections", () => {
  it("splits on scene breaks and joins back byte for byte", () => {
    const split = splitDraftSections(body)

    expect(split.sections).toHaveLength(3)
    expect(joinDraftSections(split)).toBe(body)
  })

  it("keeps the blank lines around a rewritten section", () => {
    expect(replaceSectionText("\n원문\n", "  새 문장  ")).toBe("\n새 문장\n")
  })
})

describe("locateQuoteSection", () => {
  const { sections } = splitDraftSections(body)

  it("finds a verbatim quote", () => {
    expect(locateQuoteSection(sections, "은하가 기다리고")).toBe(1)
  })

  it("ignores spacing and punctuation the model added", () => {
    expect(locateQuoteSection(sections, "“바베큐  연기가, 자욱했다”")).toBe(2)
  })

  it("places a paraphrased quote by its shared runs", () => {
    expect(locateQuoteSection(sections, "엄마가 손뼉을 짝짝 쳤고")).toBe(0)
  })

  it("uses the longest fragment of an elided quote", () => {
    expect(locateQuoteSection(sections, "교문을…은하가 기다리고 있었다")).toBe(1)
  })

  it("places nothing without a quote", () => {
    expect(locateQuoteSection(sections, "")).toBeUndefined()
    expect(locateQuoteSection(sections, undefined)).toBeUndefined()
  })
})

describe("planSectionRevisions", () => {
  const continuity: ContinuityIssueLike = {
    original: "교문을 나서자",
    reason: "아직 아침이다",
    severity: "high"
  }
  const unquoted: DraftCritiqueIssue = { category: "purpose", severity: "high", comment: "목적이 흐리다" }

  it("plans only the sections an issue quotes", () => {
    const plans = planSectionRevisions(body, [continuity], [], [])

    expect(plans.map((plan) => plan.section)).toEqual([1])
    expect(plans[0]?.instructions.join("\n")).toContain("아직 아침이다")
  })

  it("sends an issue that quotes nothing to every section", () => {
    const plans = planSectionRevisions(body, [continuity], [unquoted], [])

    expect(plans.map((plan) => plan.section)).toEqual([0, 1, 2])
    expect(plans[1]?.instructions.join("\n")).toContain("아직 아침이다")
    expect(plans[0]?.instructions.join("\n")).not.toContain("아직 아침이다")
  })
})

describe("runReviseLoop by section", () => {
  const registry = { getTaskProvider: () => "mock" } as never
  const ctx = {
    format: "novel",
    intent: "",
    factLines: [],
    characterNames: [],
    characterCards: [],
    styleConstraints: [],
    qualityCriteria: [],
    styleDirective: undefined,
    characters: []
  } as never

  function serviceWith(reviseDraft: (input: { body: string }) => Promise<string>): never {
    const checkContinuity = vi
      .fn()
      .mockResolvedValueOnce([
        { original: "백과사전을 펼쳤다", reason: "모순 하나", severity: "high" },
        { original: "바베큐 연기가", reason: "모순 둘", severity: "high" }
      ])
      .mockResolvedValue([])

    return {
      checkContinuity,
      critiqueDraft: vi.fn().mockResolvedValue([]),
      reviseDraft: vi.fn(reviseDraft)
    } as never
  }

  it("rewrites only the quoted sections and leaves the rest untouched", async () => {
    const aiService = serviceWith(async ({ body: section }) => `${section} 고쳤다.`)

    const result = await runReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      ctx,
      body,
      maxIterations: 2,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    })

    const sections = splitDraftSections(result.body).sections
    expect(result.revisionCount).toBe(1)
    expect(sections[0]).toContain("고쳤다.")
    expect(sections[1]).toBe(splitDraftSections(body).sections[1])
    expect(sections[2]).toContain("고쳤다.")
  })

  it("keeps a rejected section and lands the others", async () => {
    const aiService = serviceWith(async ({ body: section }) =>
      section.startsWith("아침") ? "짧" : `${section} 고쳤다.`
    )

    const result = await runReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      ctx,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    })

    const sections = splitDraftSections(result.body).sections
    expect(result.preservedOriginal).toBe(false)
    expect(sections[0]).toBe(splitDraftSections(body).sections[0])
    expect(sections[2]).toContain("고쳤다.")
  })

  it("keeps the sections accepted before a provider timeout", async () => {
    const aiService = serviceWith(async ({ body: section }) => {
      if (section.startsWith("옥상")) {
        throw new AiProviderError("cli-timeout", "claude-code", "시간 초과")
      }
      return `${section} 고쳤다.`
    })

    const result = await runReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      ctx,
      body,
      maxIterations: 2,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    })

    expect(result.failure).toMatchObject({ stage: "revise", kind: "timeout" })
    expect(result.revisionCount).toBe(1)
    expect(splitDraftSections(result.body).sections[0]).toContain("고쳤다.")
  })

  it("rejects a section rewrite that adds a scene break", async () => {
    const aiService = serviceWith(async ({ body: section }) => `${section}\n---\n덧붙임`)

    const result = await runReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      ctx,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    })

    expect(result.body).toBe(body)
    expect(result.rejection?.reason).toBe("scene-breaks-changed")
  })
})
