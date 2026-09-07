import { describe, expect, it, vi } from "vitest"

import type {
  BackgroundCard,
  CharacterCard,
  SceneContext,
  SceneDialogueRecord,
  SceneFile
} from '@storyboard/story-format';
import { computeDraftBodyHash } from '@storyboard/story-format';
import {
  runSceneGenerationPipeline,
  planSectionCount,
  planSectionTargetLengths,
  splitSkeletonIntoSections,
  validateExpandedSection,
  validatePolishedSkeleton,
  validateSceneSkeleton,
  findRepeatedDialogueRun,
  type SceneDialogueCorpus,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineStage
} from '@storyboard/story-pipeline'

// 검증의 최소 분량(목표의 절반)을 넘겨야 재시도가 돌지 않는다. 목 응답을 그 길이로 채우되,
// 채움 문자열에 prefix 를 섞어 구간마다 다른 본문이 되게 한다. 모든 구간이 같은 글자로 채워지면
// 직전 구간 재기술 검사가(정당하게) 걸린다.
function longProse(prefix: string, length = 3000): string {
  const unit = `${prefix}묘사`
  return `${prefix} ${unit.repeat(Math.ceil((length * 2) / unit.length))}`
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
  readonly attributeSceneDialogue: ReturnType<typeof vi.fn>
  readonly expandSceneSection: ReturnType<typeof vi.fn>
} {
  return {
    createCharacterPersona: vi.fn(async () => "p"),
    describeBackground: vi.fn(async () => ""),
    draftSceneSkeleton: vi.fn(async () => "뼈대 본문"),
    polishSceneDialogue: vi.fn(async (input) => (input as { skeleton: string }).skeleton),
    attributeSceneDialogue: vi.fn(async (input) =>
      (input as { lines: readonly string[] }).lines.map((_, offset) => ({
        index: offset + 1,
        speaker: "elia"
      }))
    ),
    expandSceneSection: vi.fn(async () => longProse("살붙인 본문"))
  }
}

function createRecordingCorpus(corpus: SceneDialogueRecord[] = []): SceneDialogueCorpus {
  return { loadCorpus: async (): Promise<readonly SceneDialogueRecord[]> => corpus }
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
    const inputs = ai.expandSceneSection.mock.calls.map(
      (call) => call[0] as { skeleton: string; section: string; targetLength: number }
    )
    const budgets = planSectionTargetLengths(
      inputs.map((input) => input.section),
      15000
    )
    for (const [index, input] of inputs.entries()) {
      expect(input.skeleton).toBe(longSkeleton)
      expect(input.targetLength).toBe(budgets[index])
    }
    expect(inputs.at(-1)?.targetLength).toBeLessThan(inputs[0]?.targetLength as number)
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

  it("prefers the attempt closest to target when severity ties", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce("엘리아가 문을 연다.")
    ai.expandSceneSection
      .mockResolvedValueOnce("짧".repeat(2100))
      .mockResolvedValueOnce("중".repeat(2450))
      .mockResolvedValueOnce("긴".repeat(2500))

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      styleDirective: { targetWordCount: 6000 }
    })

    expect(result.draftBody).toContain("긴")
    expect(result.draftBody).not.toContain("짧")
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

// 구간 상한은 설정으로 내려온다. 낮추면 같은 목표 분량이 더 많은 호출로 쪼개지고, 그것이 분량을
// 늘리는 유일한 손잡이다.
describe("runSceneGenerationPipeline — 구간 상한 설정", () => {
  const longSkeleton = Array.from({ length: 6 }, (_, i) => `문단${i} ${"가".repeat(300)}`).join(
    "\n\n"
  )

  async function countExpandCalls(sectionOutputLimit?: number): Promise<number> {
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
      styleDirective: { targetWordCount: 6000 },
      ...(sectionOutputLimit === undefined ? {} : { sectionOutputLimit })
    })

    return ai.expandSceneSection.mock.calls.length
  }

  it("runs a single expansion at the default limit", async () => {
    expect(await countExpandCalls()).toBe(1)
  })

  it("splits into more calls when the limit is lowered", async () => {
    expect(await countExpandCalls(2000)).toBe(3)
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

  it("honours a configured limit in place of the default", () => {
    expect(planSectionCount(6000, 2000)).toBe(3)
    expect(planSectionCount(6000, 20000)).toBe(1)
  })
})

describe("planSectionTargetLengths", () => {
  it("splits the budget in proportion to each skeleton slice", () => {
    const sections = ["가".repeat(600), "나".repeat(300), "다".repeat(100)]

    expect(planSectionTargetLengths(sections, 10000)).toEqual([6000, 3000, 1000])
  })

  it("caps a fat slice at the output limit", () => {
    const sections = ["가".repeat(900), "나".repeat(100)]

    expect(planSectionTargetLengths(sections, 15000)).toEqual([7000, 1500])
  })

  it("ignores whitespace when weighing slices", () => {
    const sections = ["가".repeat(500) + " \n".repeat(500), "나".repeat(500)]

    expect(planSectionTargetLengths(sections, 6000)).toEqual([3000, 3000])
  })

  it("falls back to an even split when the slices are empty", () => {
    expect(planSectionTargetLengths(["", ""], 6000)).toEqual([3000, 3000])
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

describe("findRepeatedDialogueRun", () => {
  // 뼈대가 같은 대사 묶음을 두 번 적으면 그 두 자리에 각각 다른 문장으로 살이 붙어, 살붙임
  // 결과만 비교해서는 잡을 수 없다.
  it("finds a run of dialogue repeated in the same order", () => {
    const skeleton = [
      '진아가 말했다. "회수부터 하죠."',
      '도현이 답했다. "계정 접근도 막아야 해."',
      '유정이 끄덕였다. "공지는 제가 올릴게요."',
      "셋은 편집실을 나섰다.",
      '진아가 말했다. "회수부터 하죠."',
      '도현이 답했다. "계정 접근도 막아야 해."',
      '유정이 끄덕였다. "공지는 제가 올릴게요."'
    ].join("\n\n")

    expect(findRepeatedDialogueRun(skeleton)).toBeGreaterThanOrEqual(3)
  })

  it("does not count a character echoing one line", () => {
    const skeleton = ['진아가 말했다. "가자."', "둘은 걸었다.", '도현이 되뇌었다. "가자."'].join(
      "\n\n"
    )

    expect(findRepeatedDialogueRun(skeleton)).toBeLessThan(3)
  })

  it("rejects a skeleton that repeats itself", () => {
    const repeated = [
      '"회수부터 하죠."',
      '"계정 접근도 막아야 해."',
      '"공지는 제가 올릴게요."'
    ].join("\n\n")

    expect(validateSceneSkeleton(`${repeated}\n\n걸었다.\n\n${repeated}`)).not.toEqual([])
    expect(validateSceneSkeleton(repeated)).toEqual([])
  })
})

describe("validateExpandedSection", () => {
  const base = {
    characters: [eliaCard, jihoonCard],
    targetLength: 100,
    skeleton: "엘리아가 걷는다."
  }

  // 구간마다 따로 보면 각 구간은 멀쩡하다. 앞 구간을 삼킨 판이 통과하면 원고 후반이
  // 전반의 복사본이 된다.
  it("rejects an expansion that rewrites the previous section", () => {
    const previousSection = "엘리아는 골목을 빠져나왔다. ".repeat(30)
    const violations = validateExpandedSection({
      ...base,
      section: "지훈이 뒤따랐다.",
      previousSection,
      expanded: `${previousSection} 지훈이 뒤따라 걸었다. ${"묘사".repeat(200)}`
    })

    expect(violations.map((violation) => violation.kind)).toContain("repeats-previous")
  })

  // 살붙임은 구간마다 문장을 새로 쓴다. 같은 사건을 다시 다뤄도 서술이 겹치지 않으므로
  // 축자 비교는 빠져나가고, 뼈대에서 온 대사만 같게 남는다.
  it("rejects an expansion that retells the previous section with fresh prose", () => {
    const previousSection = [
      '진아가 원고를 내려다봤다. "회수부터 하죠."',
      '도현이 고개를 들었다. "계정 접근도 막아야 해."',
      '유정이 종이를 모았다. "공지는 제가 올릴게요."'
    ].join("\n\n")
    const retold = [
      '창밖이 어두워지고 있었다. 진아는 손끝을 말았다. "회수부터 하죠."',
      '도현은 의자를 뒤로 밀었다. "계정 접근도 막아야 해."',
      '유정은 파일을 덮었다. "공지는 제가 올릴게요."',
      "묘사".repeat(200)
    ].join("\n\n")

    const violations = validateExpandedSection({
      ...base,
      section: "지훈이 뒤따랐다.",
      previousSection,
      expanded: retold
    })

    expect(violations.map((violation) => violation.kind)).toContain("repeats-previous")
  })

  it("lets an expansion that merely continues from the previous section pass", () => {
    const violations = validateExpandedSection({
      ...base,
      section: "지훈이 뒤따랐다.",
      previousSection: "엘리아는 골목을 빠져나왔다. ".repeat(30),
      expanded: `지훈이 뒤따라 걸었다. ${"새로운 묘사".repeat(200)}`
    })

    expect(violations.map((violation) => violation.kind)).not.toContain("repeats-previous")
  })

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

describe("대사 화자 귀속 단계", () => {
  const skeletonWithDialogue = `엘리아가 문 앞에서 걸음을 멈췄다. "가자, 지금 당장." 지훈이 고개를 저었다. "아직은 아니야, 조금만 더." ${"복도는 조용했다. ".repeat(20)}`

  // 살붙임이 뼈대에 없던 대사를 새로 만드는 상황. 귀속은 뼈대가 아니라 이 결과를 봐야 한다.
  function expandWithExtraDialogue(section: string): string {
    return `${section} "그럼 내가 먼저 간다." ${longProse("살붙인 본문")}`
  }

  it("attributes the finished draft body, not the skeleton", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce(skeletonWithDialogue)
    ai.expandSceneSection.mockImplementation(async (input) =>
      expandWithExtraDialogue((input as { section: string }).section)
    )

    const stages: string[] = []
    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel",
      onProgress: (stage): void => {
        stages.push(stage)
      }
    })

    expect(stages.indexOf("attributeDialogue")).toBeGreaterThan(stages.lastIndexOf("expandSection"))

    const attributionInput = ai.attributeSceneDialogue.mock.calls[0]?.[0] as {
      skeleton: string
      lines: readonly string[]
      candidates: readonly { id: string }[]
    }
    expect(attributionInput.skeleton).toBe(result.draftBody)
    expect(attributionInput.lines).toContain("그럼 내가 먼저 간다.")
    expect(attributionInput.candidates.map((candidate) => candidate.id)).toEqual(["elia", "jihoon"])

    // 원고에 실린 대사가 하나도 빠지지 않아야 한다.
    const bodyLines = [...result.draftBody.matchAll(/[“"]([^”"\n]{4,})[”"]/g)].map((match) =>
      (match[1] ?? "").trim()
    )
    expect(result.dialogueRecord?.turns.map((turn) => turn.text)).toEqual(bodyLines)
    expect(result.dialogueRecord?.bodyHash).toBe(computeDraftBodyHash(result.draftBody))
  })

  it("returns the record instead of persisting it", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce(skeletonWithDialogue)
    ai.expandSceneSection.mockImplementation(async (input) =>
      expandWithExtraDialogue((input as { section: string }).section)
    )

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(result.dialogueRecord).toBeDefined()
    expect(result.dialogueRecord?.sceneStem).toBe("01-opening")
  })

  it("records unknown speakers and keeps generating when attribution throws", async () => {
    const ai = createRecordingAiService()
    ai.draftSceneSkeleton.mockResolvedValueOnce(skeletonWithDialogue)
    ai.expandSceneSection.mockImplementation(async (input) =>
      expandWithExtraDialogue((input as { section: string }).section)
    )
    ai.attributeSceneDialogue.mockRejectedValueOnce(new Error("provider down"))

    const result = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard, jihoonCard], "본문"),
      aiService: ai,
      format: "novel"
    })

    expect(result.draftBody.length).toBeGreaterThan(0)
    expect(result.warnings.join(" ")).not.toContain("귀속")
    expect(new Set(result.dialogueRecord?.turns.map((turn) => turn.speaker))).toEqual(
      new Set(["unknown"])
    )
  })

  it("feeds the character's earlier lines into the polish call", async () => {
    const ai = createRecordingAiService()
    const corpus = createRecordingCorpus([
      {
        sceneStem: "01-opening",
        bodyHash: computeDraftBodyHash("이전 씬"),
        turns: [{ index: 1, speaker: "elia", text: "값보다 내력이 먼저입니다." }]
      }
    ])

    await runSceneGenerationPipeline({
      sceneStem: "02-next",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      dialogueCorpus: corpus
    })

    const polishInput = ai.polishSceneDialogue.mock.calls[0]?.[0] as {
      voiceSamples: ReadonlyMap<string, readonly string[]>
    }
    expect(polishInput.voiceSamples.get("엘리아")).toEqual(["값보다 내력이 먼저입니다."])
  })

  it("never samples a scene that comes after the one being generated", async () => {
    const ai = createRecordingAiService()
    const corpus = createRecordingCorpus([
      {
        sceneStem: "01-opening",
        bodyHash: computeDraftBodyHash("앞 씬"),
        turns: [{ index: 1, speaker: "elia", text: "앞 씬에서 한 말입니다." }]
      },
      {
        sceneStem: "09-later",
        bodyHash: computeDraftBodyHash("뒤 씬"),
        turns: [{ index: 1, speaker: "elia", text: "뒤 씬에서 할 말입니다." }]
      }
    ])

    await runSceneGenerationPipeline({
      sceneStem: "02-next",
      context: contextFor([eliaCard], "본문"),
      aiService: ai,
      format: "novel",
      dialogueCorpus: corpus
    })

    const polishInput = ai.polishSceneDialogue.mock.calls[0]?.[0] as {
      voiceSamples: ReadonlyMap<string, readonly string[]>
    }
    expect(polishInput.voiceSamples.get("엘리아")).toEqual(["앞 씬에서 한 말입니다."])
  })
})

describe("배경 묘사 갱신", () => {
  const marketCard: BackgroundCard = {
    type: "location",
    id: "grey-market",
    name: "회색시장",
    locationKind: "place",
    characterIds: [],
    description: ["안개가 낀 무허가 시장"]
  } as BackgroundCard

  function createBackgroundStore(cached: string | undefined): {
    readonly load: ReturnType<typeof vi.fn>
    readonly save: ReturnType<typeof vi.fn>
  } {
    return { load: vi.fn(async () => cached), save: vi.fn(async () => undefined) }
  }

  it("reuses the cached atmosphere when the location has not appeared before", async () => {
    const ai = createRecordingAiService()
    const store = createBackgroundStore("고여 있는 안개")

    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor([eliaCard], "본문", marketCard),
      aiService: ai,
      format: "novel",
      backgroundStore: store
    })

    expect(store.load).toHaveBeenCalledTimes(1)
    expect(ai.describeBackground).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it("regenerates with the excerpt when the same location appears again", async () => {
    const ai = createRecordingAiService()
    const store = createBackgroundStore("고여 있는 안개")
    ai.describeBackground.mockResolvedValueOnce("돌계단 옆에 천막 좌판이 늘었다.")

    await runSceneGenerationPipeline({
      sceneStem: "05-return",
      context: contextFor([eliaCard], "본문", marketCard),
      aiService: ai,
      format: "novel",
      backgroundStore: store,
      backgroundRecentExcerpt: "돌계단 아래 천막 좌판에서 부적을 살폈다."
    })

    expect(store.load).not.toHaveBeenCalled()
    expect(ai.describeBackground).toHaveBeenCalledTimes(1)
    expect(ai.describeBackground.mock.calls[0]?.[2]).toBe("돌계단 아래 천막 좌판에서 부적을 살폈다.")

    // 이 씬 한정 값이라 카드 키 슬롯에 저장하지 않는다. 저장하면 마지막 실행 씬이 정본을 덮어쓴다.
    expect(store.save).not.toHaveBeenCalled()
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

    expect(violations.map((violation) => violation.kind)).toEqual(["dialogue-count"])
  })

  it("rejects a turn the polish quietly dropped", () => {
    const violations = validatePolishedSkeleton({
      ...base,
      skeleton: '엘리아가 말했다. "가자, 지금." 그리고 덧붙였다. "문이 닫히기 전에."',
      polished: '엘리아가 말했다. "가자, 지금." 그리고 문 쪽을 보았다.'
    })

    expect(violations.map((violation) => violation.kind)).toEqual(["dialogue-count"])
    expect(violations[0]?.detail).toContain("사라졌습니다")
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
