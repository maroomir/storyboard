import { describe, expect, it, vi } from "vitest"

import type { BackgroundCard, CharacterCard, SceneContext, SceneFile } from '@storyboard/story-format';
import {
  runSceneGenerationPipeline,
  planSectionCount,
  splitSkeletonIntoSections,
  validateExpandedSection,
  validatePolishedSkeleton,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineStage
} from '@storyboard/story-pipeline'

// 검증의 최소 분량(목표의 절반)을 넘겨야 재시도가 돌지 않는다. 목 응답을 그 길이로 채운다.
function longProse(prefix: string, length = 3000): string {
  return `${prefix} ${"묘사".repeat(length)}`
}

const eliaCard: CharacterCard = { type: "character", id: "elia", name: "엘리아", role: "main" }
const jihoonCard: CharacterCard = { type: "character", id: "jihoon", name: "지훈", role: "main" }

function sceneFile(body: string, endState?: string): SceneFile {
  return {
    stem: "01-opening",
    order: 1,
    orderText: "01",
    slug: "opening",
    frontmatter: {},
    ...(endState === undefined ? {} : { card: { type: "scene", id: "01-opening", endState } }),
    body
  } as SceneFile
}

function contextFor(
  characters: readonly CharacterCard[],
  body: string,
  background?: BackgroundCard,
  endState?: string
): SceneContext {
  return { scene: sceneFile(body, endState), characters, background }
}

function createRecordingAiService(): SceneGenerationPipelineAiService & {
  readonly createCharacterPersona: ReturnType<typeof vi.fn>
  readonly describeBackground: ReturnType<typeof vi.fn>
  readonly draftSceneSkeleton: ReturnType<typeof vi.fn>
  readonly polishSceneDialogue: ReturnType<typeof vi.fn>
  readonly expandSceneSection: ReturnType<typeof vi.fn>
} {
  return {
    createCharacterPersona: vi.fn(async () => "p"),
    describeBackground: vi.fn(async () => ""),
    draftSceneSkeleton: vi.fn(async () => "뼈대 본문"),
    polishSceneDialogue: vi.fn(async (input) => (input as { skeleton: string }).skeleton),
    expandSceneSection: vi.fn(async () => longProse("살붙인 본문"))
  }
}

describe("runSceneGenerationPipeline — 입력 검증", () => {
  it("rejects an empty scene body", async () => {
    const ai = createRecordingAiService()

    await expect(
      runSceneGenerationPipeline({
        sceneStem: "01-opening",
        context: contextFor([eliaCard], "   \n  "),
        aiService: ai,
        format: "novel"
      })
    ).rejects.toThrow(/씬 본문이 비어 있습니다/)

    expect(ai.draftSceneSkeleton).not.toHaveBeenCalled()
  })

  it("rejects when no characters are in context", async () => {
    const ai = createRecordingAiService()

    await expect(
      runSceneGenerationPipeline({
        sceneStem: "01-opening",
        context: contextFor([], "엘리아가 걷는다."),
        aiService: ai,
        format: "novel"
      })
    ).rejects.toThrow(/등장인물을 찾을 수 없습니다/)
  })
})

describe("runSceneGenerationPipeline — 뼈대 단계", () => {
  it("runs personas, then the skeleton, then one expansion per section", async () => {
    const progress: SceneGenerationPipelineStage[] = []
    const ai = createRecordingAiService()

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "엘리아와 지훈이 학교에 있다."),
      aiService: ai,
      format: "novel",
      onProgress: (stage) => progress.push(stage)
    })

    expect(progress).toEqual([
      "buildPersonas",
      "buildPersonas",
      "draftSkeleton",
      "polishDialogue",
      "expandSection"
    ])
    expect(ai.draftSceneSkeleton).toHaveBeenCalledTimes(1)
    expect(result.skeleton).toBe("뼈대 본문")
    expect(result.draftBody).toContain("살붙인 본문")
    expect(result.detectedCharacters).toEqual(["엘리아", "지훈"])
  })

  it("feeds only the narrative, not the craft blocks, to the skeleton", async () => {
    const ai = createRecordingAiService()
    const body =
      "[갈등]\n발키리가 시비를 건다\n\n[이 장면의 종료 지점]\n광장을 벗어나는 데까지\n\n이준이 좌판을 정리한다."

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], body),
      aiService: ai,
      format: "novel"
    })

    const input = ai.draftSceneSkeleton.mock.calls[0]?.[0] as { narrativeSource: string }
    expect(input.narrativeSource).toBe("이준이 좌판을 정리한다.")
    expect(input.narrativeSource).not.toContain("[갈등]")
  })

  it("gives the skeleton a third of the scene target so expansion is not a 15x job", async () => {
    const ai = createRecordingAiService()

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 15000 }
    })

    const input = ai.draftSceneSkeleton.mock.calls[0]?.[0] as { targetLength?: number }
    expect(input.targetLength).toBe(5000)
  })

  it("passes the card end state so the skeleton knows where to stop", async () => {
    const ai = createRecordingAiService()

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문", undefined, "광장을 벗어나는 데까지"),
      aiService: ai,
      format: "novel"
    })

    const input = ai.draftSceneSkeleton.mock.calls[0]?.[0] as { endState?: string }
    expect(input.endState).toBe("광장을 벗어나는 데까지")
  })

  it("gives canon facts to the skeleton only, framed as author-side background", async () => {
    const ai = createRecordingAiService()

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      canonFactLines: ["엘리아 — 비밀: 왕족"],
      previousContext: "[이전 장면]\n앞 씬 말미"
    })

    const skeletonContext = (
      ai.draftSceneSkeleton.mock.calls[0]?.[0] as { previousContext?: string }
    ).previousContext as string
    expect(skeletonContext).toContain("[설정 메모]")
    expect(skeletonContext).toContain("왕족")
    expect(skeletonContext).toContain("앞 씬 말미")

    const expansionInput = ai.expandSceneSection.mock.calls[0]?.[0] as Record<string, unknown>
    expect(JSON.stringify(expansionInput)).not.toContain("왕족")
  })
})

describe("runSceneGenerationPipeline — 살붙임 단계", () => {
  const longSkeleton = Array.from({ length: 6 }, (_, i) => `문단${i} ${"가".repeat(300)}`).join(
    "\n\n"
  )

  it("splits by target length and shows each section the whole skeleton", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce(longSkeleton)
    ai.expandSceneSection.mockImplementation(
      async (input) => longProse(`확장:${(input as { section: string }).section.slice(0, 5)}`)
    )

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 15000 }
    })

    expect(ai.expandSceneSection).toHaveBeenCalledTimes(3)
    for (const call of ai.expandSceneSection.mock.calls) {
      const input = call[0] as { skeleton: string; targetLength: number }
      expect(input.skeleton).toBe(longSkeleton)
      expect(input.targetLength).toBe(5000)
    }
  })

  it("hands the previous finished section to the next call, and none to the first", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce(longSkeleton)
    ai.expandSceneSection.mockImplementation(
      async (input) => longProse(`확장(${(input as { section: string }).section.length})`)
    )

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 15000 }
    })

    const priors = ai.expandSceneSection.mock.calls.map(
      (call) => (call[0] as { previousSection?: string }).previousSection
    )
    expect(priors[0]).toBeUndefined()
    expect(priors[1]).toMatch(/^확장\(/)
    expect(priors[2]).toMatch(/^확장\(/)
  })

  it("runs a single pass when the scene fits one section", async () => {
    const ai = createRecordingAiService()

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 5000 }
    })

    expect(ai.expandSceneSection).toHaveBeenCalledTimes(1)
  })
})

describe("runSceneGenerationPipeline — 기계 검증", () => {
  it("retries a violating section with the reason attached", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce("엘리아가 문을 연다.")
    ai.expandSceneSection
      .mockResolvedValueOnce(longProse("엘리아와 지훈이 문을 연다."))
      .mockResolvedValueOnce(longProse("엘리아가 천천히 문을 연다."))

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.expandSceneSection).toHaveBeenCalledTimes(2)
    const retryInput = ai.expandSceneSection.mock.calls[1]?.[0] as {
      retryReasons?: readonly string[]
    }
    expect(retryInput.retryReasons?.join(" ")).toContain("지훈")
    expect(result.warnings).toEqual([])
    expect(result.draftBody).toContain("엘리아가 천천히 문을 연다.")
  })

  it("accepts a still-failing attempt and records a warning when retries keep failing", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce("엘리아가 문을 연다.")
    ai.expandSceneSection.mockResolvedValue(longProse("엘리아와 지훈이 문을 연다."))

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.expandSceneSection).toHaveBeenCalledTimes(3)
    expect(result.draftBody).toContain("엘리아와 지훈이 문을 연다.")
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain("1구간")
    expect(result.warnings[0]).toContain("지훈")
  })

  it("keeps the least severe attempt rather than whichever came last", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce("엘리아가 문을 연다.")
    ai.expandSceneSection
      .mockResolvedValueOnce("엘리아가 문을 천천히 열었다.")
      .mockResolvedValueOnce(longProse("엘리아와 지훈이 문을 연다."))
      .mockResolvedValueOnce(longProse("엘리아와 지훈이 ضرب 문을 연다."))

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 6000 }
    })

    expect(ai.expandSceneSection).toHaveBeenCalledTimes(3)
    expect(result.draftBody).toContain("엘리아가 문을 천천히 열었다.")
    expect(result.warnings[0]).toContain("크게 못 미칩니다")
  })
})

describe("planSectionCount", () => {
  it("keeps each section under the output limit", () => {
    expect(planSectionCount(5000)).toBe(1)
    expect(planSectionCount(7000)).toBe(1)
    expect(planSectionCount(15000)).toBe(3)
    expect(planSectionCount(20000)).toBe(3)
  })

  it("falls back to a single section without a target", () => {
    expect(planSectionCount(0)).toBe(1)
  })
})

describe("splitSkeletonIntoSections", () => {
  const skeleton = Array.from({ length: 9 }, (_, i) => `문단${i} ${"가".repeat(200)}`).join("\n\n")

  it("returns the requested number of sections at paragraph boundaries", () => {
    expect(splitSkeletonIntoSections(skeleton, 3)).toHaveLength(3)
    expect(splitSkeletonIntoSections(skeleton, 3).join("\n\n")).toContain("문단8")
  })

  it("never returns more sections than there are paragraphs", () => {
    expect(splitSkeletonIntoSections(skeleton, 20)).toHaveLength(9)
  })

  it("keeps a single-paragraph skeleton whole", () => {
    expect(splitSkeletonIntoSections("한 문단뿐", 3)).toEqual(["한 문단뿐"])
  })
})

describe("validateExpandedSection", () => {
  const base = {
    characters: [eliaCard, jihoonCard],
    targetLength: 100,
    skeleton: "엘리아가 걷는다."
  }

  it("passes an expansion that only thickens the prose", () => {
    const violations = validateExpandedSection({
      ...base,
      section: '엘리아가 말했다. "가자."',
      expanded:
        '엘리아가 천천히 고개를 들고 말했다. "가자." 문 밖에는 비가 내리고 있었다. ' +
        "묘사".repeat(20)
    })

    expect(violations).toEqual([])
  })

  it("flags a character the skeleton never had", () => {
    const violations = validateExpandedSection({
      ...base,
      section: "엘리아가 걷는다.",
      expanded: "엘리아가 걷는다. 지훈이 뒤따랐다. " + "묘사".repeat(30)
    })

    expect(violations.map((violation) => violation.kind)).toContain("cast")
    expect(violations[0]?.detail).toContain("지훈")
  })

  it("flags foreign script contamination", () => {
    const violations = validateExpandedSection({
      ...base,
      section: "엘리아가 걷는다.",
      expanded: "엘리아가 다음 ضرب을 향해 걷는다. " + "묘사".repeat(30)
    })

    expect(violations.map((violation) => violation.kind)).toContain("foreign-script")
  })

  it("accepts a skeleton line the expansion only reworded", () => {
    const violations = validateExpandedSection({
      ...base,
      section: '서하가 물었다. "세 번째입니다. 07-19 보관함의 병이 제 것입니까."',
      expanded: '서하가 물었다. "세 번째입니다. 07-19 병은 제 것입니까." ' + "묘사".repeat(30)
    })

    expect(violations.map((violation) => violation.kind)).not.toContain("lost-dialogue")
  })

  it("still flags a skeleton line the expansion truncated", () => {
    const violations = validateExpandedSection({
      ...base,
      section: '서하가 물었다. "세 번째입니다. 07-19 보관함의 병이 제 것입니까."',
      expanded: '서하가 물었다. "세 번째입니다." ' + "묘사".repeat(30)
    })

    expect(violations.map((violation) => violation.kind)).toContain("lost-dialogue")
  })

  it("flags a skeleton line that the expansion dropped", () => {
    const violations = validateExpandedSection({
      ...base,
      section: '엘리아가 말했다. "여기서 기다려."',
      expanded: "엘리아가 아무 말 없이 서 있었다. " + "묘사".repeat(30)
    })

    expect(violations.map((violation) => violation.kind)).toContain("lost-dialogue")
  })

  it("flags an expansion that stopped well short of its section target", () => {
    const violations = validateExpandedSection({
      ...base,
      section: "엘리아가 걷는다.",
      expanded: "묘사".repeat(35)
    })

    expect(violations.map((violation) => violation.kind)).toContain("too-short")
  })

  it("flags an expansion that came back far too short", () => {
    const violations = validateExpandedSection({
      ...base,
      section: "엘리아가 걷는다.",
      expanded: "짧다."
    })

    expect(violations.map((violation) => violation.kind)).toContain("too-short")
  })
})

describe("대사 다듬기 단계", () => {
  it("polishes the skeleton before splitting, and expands the polished text", async () => {
    const ai = createRecordingAiService()
    const skeleton = `엘리아가 문 앞에서 걸음을 멈췄다. "가자, 지금." ${"복도는 조용했다. ".repeat(20)}`
    const polished = skeleton.replace('"가자, 지금."', '"가자, 지금 당장."')
    ai.draftSceneSkeleton.mockResolvedValueOnce(skeleton)
    ai.polishSceneDialogue.mockResolvedValueOnce(polished)
    ai.expandSceneSection.mockImplementation(async (input) =>
      longProse((input as { section: string }).section)
    )

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.polishSceneDialogue).toHaveBeenCalledTimes(1)
    expect(result.skeleton).toBe(polished)

    const expansionInput = ai.expandSceneSection.mock.calls[0]?.[0] as { skeleton: string }
    expect(expansionInput.skeleton).toBe(polished)
    expect(result.warnings).toEqual([])
  })

  it("hands the personas to the polish call so voices stay distinct", async () => {
    const ai = createRecordingAiService()

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    const input = ai.polishSceneDialogue.mock.calls[0]?.[0] as {
      personas: ReadonlyMap<string, string>
    }
    expect(Array.from(input.personas.keys())).toEqual(["엘리아", "지훈"])
  })

  it("falls back to the original skeleton and warns when polishing adds a character", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce("엘리아가 문을 연다.")
    ai.polishSceneDialogue.mockResolvedValue("엘리아가 문을 연다. 지훈이 들어왔다.")

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(ai.polishSceneDialogue).toHaveBeenCalledTimes(2)
    expect(result.skeleton).toBe("엘리아가 문을 연다.")
    expect(result.warnings[0]).toContain("대사 다듬기를 되돌렸습니다")
    expect(result.warnings[0]).toContain("지훈")
  })
})

describe("validatePolishedSkeleton", () => {
  const base = { characters: [eliaCard, jihoonCard], lengthLimit: 1000 }

  it("allows a line rewritten in the character's own voice", () => {
    const violations = validatePolishedSkeleton({
      ...base,
      skeleton: '엘리아가 말했다. "가자, 지금."',
      polished: '엘리아가 말했다. "가자, 지금. 더 늦으면 문이 닫혀."'
    })

    expect(violations).toEqual([])
  })

  it("rejects a turn the skeleton never had", () => {
    const violations = validatePolishedSkeleton({
      ...base,
      skeleton: '엘리아가 말했다. "가자, 지금."',
      polished: '엘리아가 말했다. "가자, 지금." 그리고 다시 말했다. "지금 가자는 뜻입니까."'
    })

    expect(violations.map((violation) => violation.kind)).toEqual(["added-dialogue"])
  })

  it("rejects a character the skeleton never had", () => {
    const violations = validatePolishedSkeleton({
      ...base,
      skeleton: '엘리아가 걷는다. "혼자 가."',
      polished: '엘리아가 걷는다. "혼자 갈게." 지훈이 뒤따랐다.'
    })

    expect(violations.map((violation) => violation.kind)).toEqual(["cast"])
  })

  it("rejects a polish that more than doubled the skeleton", () => {
    const violations = validatePolishedSkeleton({
      ...base,
      skeleton: "엘리아가 걷는다.",
      polished: "엘리아가 걷는다. " + "말".repeat(2000),
      lengthLimit: 100
    })

    expect(violations.map((violation) => violation.kind)).toContain("too-long")
  })
})

describe("splitSkeletonIntoSections — 장면 전환 우선 절단", () => {
  const paragraph = (n: number): string => `문단${n} ${"가".repeat(200)}`

  it("cuts at a scene break rather than mid-paragraph", () => {
    const skeleton = [paragraph(1), paragraph(2), "---", paragraph(3), paragraph(4), paragraph(5), "---", paragraph(6), paragraph(7), paragraph(8)].join("\n\n")

    const sections = splitSkeletonIntoSections(skeleton, 3)

    expect(sections).toHaveLength(3)
    expect(sections[0]?.endsWith("---")).toBe(true)
  })

  it("falls back to paragraph boundaries when the skeleton has no scene break", () => {
    const skeleton = Array.from({ length: 9 }, (_, i) => paragraph(i + 1)).join("\n\n")

    expect(splitSkeletonIntoSections(skeleton, 3)).toHaveLength(3)
  })
})

describe("별칭·게임명 오탐 방지", () => {
  const zeroCard: CharacterCard = {
    type: "character",
    id: "ijun",
    name: "이준",
    role: "main",
    attributes: { gamename: "제로" }
  }

  it("does not flag a game name as a new character in expansion", () => {
    const violations = validateExpandedSection({
      skeleton: "이준은 스크린샷을 보았다.",
      section: "이준은 스크린샷을 보았다.",
      expanded: longProse("사진 속에는 제로라는 이름이 남아 있었다. 이준은 그것을 오래 보았다."),
      characters: [zeroCard],
      targetLength: 10
    })

    expect(violations).toEqual([])
  })

  it("does not flag a game name as a new character in polishing", () => {
    const violations = validatePolishedSkeleton({
      skeleton: '이준은 스크린샷을 보았다. "저 자리 기억나?"',
      polished: '이준은 스크린샷을 보았다. "제로, 저 자리 기억나?"',
      characters: [zeroCard],
      lengthLimit: 1000
    })

    expect(violations).toEqual([])
  })
})

describe("출연진은 씬 전체 기준으로 판정한다", () => {
  it("does not flag a character the section referred to only by pronoun", () => {
    const violations = validateExpandedSection({
      skeleton: "엘리아와 지훈이 골목을 지난다. 지훈이 앞장섰다.",
      section: "그는 골목 끝에서 걸음을 멈췄다.",
      expanded: longProse("지훈은 골목 끝에서 걸음을 멈췄다. 엘리아가 그 옆에 섰다."),
      characters: [eliaCard, jihoonCard],
      targetLength: 10
    })

    expect(violations).toEqual([])
  })

  it("still flags a character absent from the whole skeleton", () => {
    const violations = validateExpandedSection({
      skeleton: "엘리아가 골목을 지난다.",
      section: "엘리아가 골목을 지난다.",
      expanded: longProse("엘리아가 골목을 지난다. 지훈이 뒤따라 나타났다."),
      characters: [eliaCard, jihoonCard],
      targetLength: 10
    })

    expect(violations.map((violation) => violation.kind)).toContain("cast")
  })
})
