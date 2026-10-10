import { describe, expect, it, vi } from "vitest"

import type { CharacterCard, SceneContext, SceneFile } from "@storyboard/story-model"
import {
  condensePreviousContext,
  findRepeatedDialogueRun,
  findRepeatedDialogueRunBetween,
  pipelineDefaults,
  resolveSceneGenerationTuning,
  runSceneGenerationPipeline,
  selectRepresentativeDialogue,
  validateExpandedSection,
  validatePolishedSkeleton,
  validateSceneSkeleton,
  type SceneGenerationPipelineAiService,
} from "@storyboard/story-engine"
import { sectionViolationKinds } from "@storyboard/story-model"

// 손잡이를 넓히면서 기본값이 한 칸이라도 움직였는지 보는 대조 테스트. 파이프라인 동작을 바꾸는
// 커밋이 아니라 «주입 가능하게만 만드는» 커밋이라는 것을 이 파일이 증명한다.

const defaults = resolveSceneGenerationTuning()

describe("resolveSceneGenerationTuning", () => {
  it("reproduces the data file exactly", () => {
    expect(defaults).toEqual({
      sectionRetryLimit: pipelineDefaults.section.retryLimit,
      sectionMinimumLengthRatio: pipelineDefaults.section.minimumLengthRatio,
      sectionRepeatedRunWindow: pipelineDefaults.section.repeatedRunWindow,
      sectionRepeatedRunLimit: pipelineDefaults.section.repeatedRunLimit,
      skeletonRatio: pipelineDefaults.skeleton.lengthRatio,
      skeletonRetryLimit: pipelineDefaults.skeleton.retryLimit,
      skeletonMinimumLengthRatio: pipelineDefaults.skeleton.minimumLengthRatio,
      sceneBreakTimeJumpMinutes: pipelineDefaults.sceneBreak.timeJumpMinutes,
      dialoguePreservedRatio: pipelineDefaults.dialogue.preservedRatio,
      dialogueSplitLimit: pipelineDefaults.dialogue.splitLimit,
      dialogueRepeatedRunLimit: pipelineDefaults.dialogue.repeatedRunLimit,
      dialogueMinimumLineLength: pipelineDefaults.dialogue.minimumLineLength,
      dialogueMinimumQuotedLength: pipelineDefaults.dialogue.minimumQuotedLength,
      polishLengthLimitRatio: pipelineDefaults.polish.lengthLimitRatio,
      polishRetryLimit: pipelineDefaults.polish.retryLimit,
      catchphrasePerBeatLimit: pipelineDefaults.catchphrase.perBeatLimit,
      paddingParagraphRatio: pipelineDefaults.padding.paragraphRatio,
      paddingParagraphMinimumLength: pipelineDefaults.padding.paragraphMinimumLength,
      voiceSampleLimit: pipelineDefaults.voiceSamples.limit,
      voiceSampleMinimumLength: pipelineDefaults.voiceSamples.minimumLength,
      voiceSampleMaximumLength: pipelineDefaults.voiceSamples.maximumLength,
      contextCondensedMaxChars: pipelineDefaults.context.condensedMaxChars,
      violationWeights: pipelineDefaults.violationWeights
    })
  })

  it("treats an empty override the same as no override", () => {
    expect(resolveSceneGenerationTuning({})).toEqual(defaults)
  })

  // 스칼라가 하나 늘었는데 손잡이를 안 뚫으면 그 값은 조용히 측정 밖으로 빠진다. 여기서 막는다.
  it("covers every scalar in the data file except the documented exclusion", () => {
    const leaves: string[] = []

    const walk = (value: unknown, path: string): void => {
      if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) {
          walk(child, path === "" ? key : `${path}.${key}`)
        }
        return
      }
      leaves.push(path)
    }

    walk(pipelineDefaults, "")

    // context.maxSceneBreakNewlines 는 파이프라인이 아니라 엔진의 씬 입력 조립에서 쓰인다.
    const expected = leaves.filter((leaf) => leaf !== "context.maxSceneBreakNewlines")
    const exposed =
      Object.keys(defaults).length -
      1 +
      Object.keys(defaults.violationWeights).length

    expect(exposed).toBe(expected.length)
  })

  it("keeps the violation scale keyed by the section violation kinds", () => {
    expect(Object.keys(defaults.violationWeights).sort()).toEqual([...sectionViolationKinds].sort())
  })

  it("fills only the omitted weights when some are overridden", () => {
    const resolved = resolveSceneGenerationTuning({ "generation.violationWeights.cast": 99 })

    expect(resolved.violationWeights.cast).toBe(99)
    expect(resolved.violationWeights.repetition).toBe(pipelineDefaults.violationWeights.repetition)
  })
})

describe("pure validators are unchanged by an explicit default", () => {
  const elia: CharacterCard = { type: "character", id: "elia", name: "엘리아", role: "main" }
  const quoted = `"오늘은 여기까지 하자, 정말로."`
  const repeated = `${quoted}\n\n${quoted}\n\n${quoted}`
  const prose = "엘리아가 문을 열고 천천히 걸어 들어왔다. ".repeat(20)

  const skeletonCases: readonly (readonly [string, number | undefined])[] = [
    [repeated, undefined],
    [prose, 1000],
    [prose, undefined],
    ["가".repeat(300), 1000]
  ]

  it.each(skeletonCases)("validateSceneSkeleton(%#)", (skeleton, targetLength) => {
    const bare = validateSceneSkeleton(skeleton, targetLength)

    expect(validateSceneSkeleton(skeleton, targetLength, {})).toEqual(bare)
    expect(validateSceneSkeleton(skeleton, targetLength, defaults)).toEqual(bare)
  })

  const expandedCases = [
    { skeleton: prose, section: prose, expanded: prose, targetLength: 100 },
    { skeleton: quoted, section: quoted, expanded: prose, targetLength: 100 },
    { skeleton: prose, section: prose, expanded: "짧다", targetLength: 5000 },
    { skeleton: repeated, section: repeated, expanded: repeated, targetLength: 10 }
  ]

  it.each(expandedCases)("validateExpandedSection(%#)", (base) => {
    const input = { ...base, characters: [elia] }
    const bare = validateExpandedSection(input)

    expect(validateExpandedSection({ ...input, tuning: {} })).toEqual(bare)
    expect(validateExpandedSection({ ...input, tuning: defaults })).toEqual(bare)
  })

  const polishedCases = [
    { skeleton: quoted, polished: quoted, lengthLimit: 1000 },
    { skeleton: quoted, polished: `${quoted}\n${quoted}`, lengthLimit: 1000 },
    { skeleton: prose, polished: prose, lengthLimit: 10 }
  ]

  it.each(polishedCases)("validatePolishedSkeleton(%#)", (base) => {
    const input = { ...base, characters: [elia] }
    const bare = validatePolishedSkeleton(input)

    expect(validatePolishedSkeleton({ ...input, tuning: {} })).toEqual(bare)
    expect(validatePolishedSkeleton({ ...input, tuning: defaults })).toEqual(bare)
  })

  it("findRepeatedDialogueRun", () => {
    const bare = findRepeatedDialogueRun(repeated)

    expect(findRepeatedDialogueRun(repeated, {})).toBe(bare)
    expect(findRepeatedDialogueRun(repeated, defaults)).toBe(bare)
  })

  it("findRepeatedDialogueRunBetween", () => {
    const bare = findRepeatedDialogueRunBetween(repeated, repeated)

    expect(findRepeatedDialogueRunBetween(repeated, repeated, {})).toBe(bare)
    expect(findRepeatedDialogueRunBetween(repeated, repeated, defaults)).toBe(bare)
  })

  it("condensePreviousContext", () => {
    const long = "앞 씬의 맥락.\n\n\n".repeat(500)

    expect(condensePreviousContext(long, true, defaults.contextCondensedMaxChars)).toBe(
      condensePreviousContext(long, true)
    )
  })

  it("selectRepresentativeDialogue", () => {
    const records = [
      {
        sceneStem: "01-opening",
        turns: Array.from({ length: 20 }, (_, index) => ({
          index,
          speaker: "elia",
          text: `엘리아의 대사 ${index} 입니다`
        }))
      }
    ]

    const bare = selectRepresentativeDialogue(records, "elia", "09-late")

    expect(
      selectRepresentativeDialogue(records, "elia", "09-late", defaults.voiceSampleLimit, {
        minimumLength: defaults.voiceSampleMinimumLength,
        maximumLength: defaults.voiceSampleMaximumLength
      })
    ).toEqual(bare)
  })
})

// 순수 함수가 같아도 파이프라인이 손잡이를 다른 자리에 꽂았으면 호출 순서나 인자가 달라진다.
// 재시도 루프와 후보 저울까지 실제로 돌려 두 실행이 완전히 같은지 본다.
describe("the whole pipeline is unchanged by an explicit default", () => {
  const elia: CharacterCard = { type: "character", id: "elia", name: "엘리아", role: "main" }

  function sceneFile(): SceneFile {
    return {
      stem: "01-opening",
      order: 1,
      orderText: "01",
      slug: "opening",
      frontmatter: {},
      body: "엘리아가 문을 열고 들어온다. 비가 내리고 있었다."
    } as SceneFile
  }

  function contextFor(): SceneContext {
    return { scene: sceneFile(), characters: [elia] }
  }

  // 뼈대를 일부러 짧게 내보내 분량 미달 재시도를 돌리고, 살붙임에도 위반을 심어 후보 저울이
  // 실제로 쓰이게 한다. 손잡이가 잘못 꽂히면 여기서 호출 수가 갈린다.
  function createScriptedAiService(log: string[]): SceneGenerationPipelineAiService {
    let skeletonCalls = 0
    let expandCalls = 0

    return {
      createCharacterPersona: vi.fn(async () => {
        log.push("persona")
        return "페르소나"
      }),
      describeBackground: vi.fn(async () => {
        log.push("background")
        return ""
      }),
      draftSceneSkeleton: vi.fn(async (input) => {
        skeletonCalls += 1
        const { targetLength } = input as { targetLength?: number }
        log.push(`skeleton:${skeletonCalls}:${targetLength ?? "none"}`)
        return `"들어와, 엘리아." 짧은 뼈대 ${skeletonCalls}`
      }),
      polishSceneDialogue: vi.fn(async () => {
        log.push("polish")
        return { rewrites: [], isTruncated: false }
      }),
      attributeSceneDialogue: vi.fn(async (input) => {
        log.push("attribute")
        return (input as { lines: readonly string[] }).lines.map((_, offset) => ({
          index: offset + 1,
          speaker: "elia"
        }))
      }),
      expandSceneSection: vi.fn(async (input) => {
        expandCalls += 1
        const { targetLength } = input as { targetLength: number }
        log.push(`expand:${expandCalls}:${targetLength}`)
        return `살붙인 본문 ${expandCalls}`
      })
    }
  }

  it("produces the same call log and the same result", async () => {
    const bareLog: string[] = []
    const bare = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor(),
      aiService: createScriptedAiService(bareLog),
      format: "novel",
      styleDirective: { targetWordCount: 3000 }
    })

    const tunedLog: string[] = []
    const tuned = await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor(),
      aiService: createScriptedAiService(tunedLog),
      format: "novel",
      styleDirective: { targetWordCount: 3000 },
      tuning: defaults
    })

    expect(tunedLog).toEqual(bareLog)
    expect(tuned.draftBody).toBe(bare.draftBody)
    expect(tuned.skeleton).toBe(bare.skeleton)
    expect(tuned.warnings).toEqual(bare.warnings)
    expect(tuned.dialogueRecord).toEqual(bare.dialogueRecord)
  })

  it("actually exercises the retry loops it claims to", async () => {
    const log: string[] = []
    await runSceneGenerationPipeline({
      sceneStem: "01-opening",
      context: contextFor(),
      aiService: createScriptedAiService(log),
      format: "novel",
      styleDirective: { targetWordCount: 3000 }
    })

    expect(log.filter((entry) => entry.startsWith("skeleton:")).length).toBeGreaterThan(1)
    expect(log.filter((entry) => entry.startsWith("expand:")).length).toBeGreaterThan(1)
  })
})
