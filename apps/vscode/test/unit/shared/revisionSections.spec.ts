import { describe, expect, it, vi } from "vitest"

import { AiProviderError, type ContinuityIssueLike, type DraftCritiqueIssue } from '@storyboard/story-model';
import {
  joinDraftSections,
  locateQuoteSection,
  planSectionRevisions,
  replaceSectionText,
  ReviseLoop,
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

  it("cuts a long section at paragraph breaks into even parts and joins back byte for byte (#213)", () => {
    const paragraph: string = `${"가".repeat(98)}\n\n`
    const longScene: string = paragraph.repeat(25)
    const longBody: string = `${longScene}\n---\n\n짧은 장면.`

    const split = splitDraftSections(longBody, { maxSectionChars: 1000 })

    expect(split.sections).toHaveLength(4)
    expect(split.sections.slice(0, 3).every((part) => part.length <= 1000 && part.endsWith("\n\n"))).toBe(true)
    expect(split.sections[3]).toBe("\n짧은 장면.")
    expect(joinDraftSections(split)).toBe(longBody)
  })

  it("leaves a section with no line break whole", () => {
    const split = splitDraftSections("가".repeat(50), { maxSectionChars: 10 })

    expect(split.sections).toHaveLength(1)
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

describe("ReviseLoop by section", () => {
  const registry = { getTaskProvider: () => "mock" } as never
  const loopContext = {
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
      reviseDraft: vi.fn(async (input: { body: string }) => ({ text: await reviseDraft(input), isTruncated: false }))
    } as never
  }

  it("rewrites only the quoted sections and leaves the rest untouched", async () => {
    const aiService = serviceWith(async ({ body: section }) => `${section} 고쳤다.`)

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 2,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    }).run()

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

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    }).run()

    const sections = splitDraftSections(result.body).sections
    expect(result.preservedOriginal).toBe(false)
    expect(sections[0]).toBe(splitDraftSections(body).sections[0])
    expect(sections[2]).toContain("고쳤다.")
  })

  it("reports each section judgement with both texts, and tags the call with its section and round", async () => {
    const aiService = serviceWith(async ({ body: section }) =>
      section.startsWith("아침") ? "짧" : `${section} 고쳤다.`
    )
    const judgements: { round: number; section: number; originalText: string; candidateText: string; rejectionReason?: string }[] = []

    await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50,
      onSectionJudged: (judgement): void => void judgements.push(judgement)
    }).run()

    const reviseDraft = (aiService as { reviseDraft: { mock: { calls: [unknown, { traceTag?: unknown }][] } } }).reviseDraft
    expect(judgements.map((judgement) => [judgement.round, judgement.section, judgement.rejectionReason])).toEqual([
      [1, 0, "too-short"],
      [1, 2, undefined]
    ])
    expect(judgements[0]?.candidateText).toBe("짧")
    expect(judgements[1]?.candidateText).toBe(`${judgements[1]?.originalText} 고쳤다.`)
    expect(reviseDraft.mock.calls.map((call) => call[1].traceTag)).toEqual([
      { sectionIndex: 1, attempt: 1 },
      { sectionIndex: 3, attempt: 1 }
    ])
  })

  it("keeps the sections accepted before a provider timeout", async () => {
    const aiService = serviceWith(async ({ body: section }) => {
      if (section.startsWith("옥상")) {
        throw new AiProviderError("cli-timeout", "claude-code", "시간 초과")
      }
      return `${section} 고쳤다.`
    })

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 2,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    }).run()

    expect(result.failure).toMatchObject({ stage: "revise", kind: "timeout" })
    expect(result.revisionCount).toBe(1)
    expect(splitDraftSections(result.body).sections[0]).toContain("고쳤다.")
  })

  it("rejects a section rewrite that adds a scene break", async () => {
    const aiService = serviceWith(async ({ body: section }) => `${section}\n---\n덧붙임`)

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    }).run()

    expect(result.body).toBe(body)
    expect(result.rejection?.reason).toBe("scene-breaks-changed")
  })

  it("rewrites a long scene part by part (#213)", async () => {
    const longBody: string = `${"백과사전을 펼쳤다. ".repeat(9)}\n\n`.repeat(6).trimEnd()
    const reviseDraft = vi.fn(async (input: { body: string }) => ({ text: `${input.body} 고쳤다.`, isTruncated: false }))
    const aiService = {
      checkContinuity: vi
        .fn()
        .mockResolvedValueOnce([{ original: "", reason: "전반의 모순", severity: "high" }])
        .mockResolvedValue([]),
      critiqueDraft: vi.fn().mockResolvedValue([]),
      reviseDraft
    } as never

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body: longBody,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50,
      sectionMaxChars: 250
    }).run()

    expect(reviseDraft).toHaveBeenCalledTimes(3)
    expect(reviseDraft.mock.calls.every(([input]) => input.body.length <= 250)).toBe(true)
    expect(result.body.match(/고쳤다\./g)).toHaveLength(3)
    expect(result.body.split("\n\n")).toHaveLength(6)
  })

  it("goes on to the other sections when one answer is lost at the output limit (#213)", async () => {
    const aiService = serviceWith(async ({ body: section }) => {
      if (section.startsWith("아침")) {
        throw new AiProviderError("output-limit", "claude", "출력 한도")
      }
      return `${section} 고쳤다.`
    })

    const result = await new ReviseLoop({
      aiService,
      registry,
      attribution: { primary: { kind: "scene", id: "01" } },
      loopContext,
      body,
      maxIterations: 1,
      reviseScoreThreshold: 0,
      maxCompressionPercent: 50
    }).run()

    const sections = splitDraftSections(result.body).sections
    expect(result.failure).toBeUndefined()
    expect(result.revisionCount).toBe(1)
    expect(sections[0]).toBe(splitDraftSections(body).sections[0])
    expect(sections[2]).toContain("고쳤다.")
    expect(result.rounds[0]?.rewrite?.rejectedSections).toEqual([
      expect.objectContaining({ section: 0, reason: "truncated", candidateLength: 0 })
    ])
  })
})
