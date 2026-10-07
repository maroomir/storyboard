import { stubFileSystem } from "../../stubs/fileSystem"
import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ChapterPlan,
  StoryboardProject,
  NovelRunState,
  NovelStageName,
} from '@storyboard/story-model';
import {
  novelStageNames,
  parseNovelRunState,
  serializeNovelRunState,
} from "@storyboard/story-model"
import {
  overrideNovelPipelinePlan,
  resetNovelPipelinePlan,
  resolveNovelPipelinePlan,
} from "@storyboard/story-engine"

const generatedResult = {
  ok: true,
  kind: "generated",
  draftUri: vscode.Uri.file("/ws/draft/01.md"),
  warnings: [] as readonly string[]
} as const
const generateDraftMock = vi.fn(async () => generatedResult)
const runReviseDraftWorkflowMock = vi.fn(async () => ({
  passed: true,
  revisionCount: 0,
  remainingBlocking: 0,
  cancelled: false,
  instructions: [] as string[]
}))
const recordRevisionEntryMock = vi.fn(async () => undefined)
const summarizeChaptersMock = vi.fn()
const checkContinuityMock = vi.fn(async () => [] as unknown[])
const critiqueDraftMock = vi.fn(async () => [] as unknown[])
const saveReviewMock = vi.fn(async () => undefined)
const generateOutlineSynopsisMock = vi.fn(async () => ({
  logline: "",
  genrePromise: "",
  mainConflicts: [] as string[],
  ending: "",
  theme: "",
  tone: "",
  styleRules: [] as string[]
}))
const saveSynopsisMock = vi.fn(async () => undefined)
const generateOutlineCharactersMock = vi.fn(async () => [{ id: "hero", name: "주인공", description: [] }] as unknown[])

vi.mock("../../../../../packages/story-engine/src/persistence/revisionPlanRecorder", () => ({
  recordRevisionEntry: (...args: unknown[]): unknown => recordRevisionEntryMock(...args)
}))
vi.mock("../../../../../packages/story-engine/src/persistence/characterBriefs", () => ({ listCharacterBriefs: async (): Promise<unknown[]> => [] }))
vi.mock("../../../../../packages/story-engine/src/persistence/manuscriptDrafts", () => ({ collectDraftsByOrder: async (): Promise<unknown[]> => [] }))
vi.mock("@storyboard/story-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-model")>()),
  // 검수는 장을 창으로 삼으므로 조립 결과에 장이 있어야 한다.
  assembleManuscript: (): unknown => ({
    chapters: [
      { fileName: "01-ch-1.md", actTitle: "1막", chapterTitle: "1장", markdown: "1장 본문" },
      { fileName: "02-ch-2.md", actTitle: "1막", chapterTitle: "2장", markdown: "2장 본문" }
    ],
    volumeMarkdown: "",
    includedCount: 0
  })
}))
vi.mock("@storyboard/story-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-engine")>()),
  buildManuscriptReviewMarkdown: (): string => ""
}))
vi.mock("@storyboard/story-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-ai")>()),
  StoryboardAiService: class {
    generateOutlineSynopsis = async (): Promise<unknown> => ({
      logline: "",
      genrePromise: "",
      mainConflicts: [],
      ending: "",
      theme: "",
      tone: "",
      styleRules: []
    })
    generateChapterPlan = async (): Promise<unknown> => ({ version: "1.0.0", acts: [] })
    checkContinuity = async (): Promise<unknown[]> => []
    critiqueDraft = async (): Promise<unknown[]> => []
    summarizeChapter = async (): Promise<string> => ""
  }
}))

import {
  NovelPipeline,
  type NovelPipelineDependencies,
  type NovelPipelineRunOptions
} from "@storyboard/story-engine"

const samplePlan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "1막",
      chapters: [
        {
          id: "ch-1",
          title: "1장",
          scenes: [
            { id: "s1", title: "씬1", purpose: "", characters: ["hero"], foreshadowing: [], neededCanon: [] },
            { id: "s2", title: "씬2", purpose: "", characters: ["hero"], foreshadowing: [], neededCanon: [] }
          ]
        },
        {
          id: "ch-2",
          title: "2장",
          scenes: [
            { id: "s3", title: "씬3", purpose: "", characters: ["hero"], foreshadowing: [], neededCanon: [] }
          ]
        }
      ]
    }
  ]
}

const project: StoryboardProject = {
  version: "1.0.0",
  id: "p1",
  name: "테스트 소설",
  format: "novel",
  language: "ko",
  createdAt: new Date().toISOString(),
  editor: { scenePrefixDigits: 2 }
}

const workspaceUri = vscode.Uri.file("/ws/project")

interface PipelineHarness {
  readonly dependencies: NovelPipelineDependencies
  readonly options: NovelPipelineRunOptions
  readonly progressStages: NovelStageName[]
  readonly progressMessages: { stage: NovelStageName; message: string }[]
  readonly persistedStates: NovelRunState[]
  readonly approvals: { kind: string; info: string }[]
}

function createHarness(overrides: Partial<NovelPipelineRunOptions> = {}): PipelineHarness {
  const progressStages: NovelStageName[] = []
  const progressMessages: { stage: NovelStageName; message: string }[] = []
  const persistedStates: NovelRunState[] = []
  const approvals: { kind: string; info: string }[] = []

  const dependencies: NovelPipelineDependencies = {
    aiGateway: {
      createService: () => ({
        generateOutlineSynopsis: async (): Promise<unknown> => generateOutlineSynopsisMock(),
        generateChapterPlan: async (): Promise<unknown> => ({ version: "1.0.0", acts: [] }),
        generateOutlineCharacters: async (): Promise<unknown[]> => generateOutlineCharactersMock(),
        checkContinuity: async (): Promise<unknown[]> => checkContinuityMock(),
        critiqueDraft: async (): Promise<unknown[]> => critiqueDraftMock(),
        summarizeChapter: async (): Promise<string> => ""
      }),
      getTaskProvider: () => "mock"
    } as never,
    aiProviderRegistry: { getTaskProvider: () => "mock" } as never,
    cardWriter: {
      exists: async (): Promise<boolean> => false,
      write: async (): Promise<unknown> => workspaceUri
    } as never,
    assembleManuscriptUseCase: {
      execute: async (): Promise<unknown> => ({ ok: true, kind: "assembled" })
    } as never,
    configBridge: { inspectScenePrefixDigits: (): undefined => undefined } as never,
    generateDraftUseCase: { execute: (...args: unknown[]): unknown => generateDraftMock(...args) } as never,
    logger: { error: () => undefined, info: () => undefined } as never,
    novelReviewRepository: {
      loadReviewSource: async (): Promise<unknown> => ({
        draftsByOrder: new Map([
          [1, { stem: "01-s1", body: "씬1 본문" }],
          [2, { stem: "02-s2", body: "씬2 본문" }],
          [3, { stem: "03-s3", body: "씬3 본문" }]
        ]),
        canonFactLines: ["hero — 나이: 17"],
        chapterSummaries: []
      }),
      saveReview: async (_root: unknown, markdown: string): Promise<void> => {
        saveReviewMock(markdown)
      }
    } as never,
    novelRunStateRepository: {
      readExisting: async (): Promise<undefined> => undefined,
      loadProject: async (): Promise<unknown> => project,
      save: async (_root: unknown, state: NovelRunState): Promise<void> => {
        persistedStates.push(parseNovelRunState(serializeNovelRunState(state)))
      }
    } as never,
    outlineRepository: {
      hasChapterPlan: async (): Promise<boolean> => false,
      // The sample plan casts only hero, so the cast stage has nothing to ask for.
      loadCharacterBriefs: async (): Promise<unknown[]> => [{ id: "hero", name: "주인공" }],
      loadChapterPlan: async (): Promise<ChapterPlan> => samplePlan,
      loadSynopsis: async (): Promise<undefined> => undefined,
      saveSynopsis: async (): Promise<void> => saveSynopsisMock(),
      save: async (): Promise<unknown> => vscode.Uri.joinPath(workspaceUri, "outline")
    } as never,
    reviseDraftUseCase: { execute: (...args: unknown[]): unknown => runReviseDraftWorkflowMock(...args) } as never,
    sceneSeedRepository: {
      saveSeeds: async (): Promise<void> => undefined,
      listSceneStemsByOrder: async (): Promise<ReadonlyMap<number, string>> => new Map(),
      saveMissingSeeds: async (): Promise<number> => 0
    } as never,
    summarizeChaptersUseCase: {
      execute: async (...args: unknown[]): Promise<unknown> => {
        summarizeChaptersMock(...args)
        return { ok: true, kind: "summarized" }
      }
    } as never,
    usageSink: { record: async (): Promise<void> => undefined },
    fileSystem: stubFileSystem
  }

  const options: NovelPipelineRunOptions = {
    workspaceUri,
    project,
    runMode: "auto",
    reviseMaxIterations: 2,
    onProgress: (stage, message): void => {
      progressStages.push(stage)
      progressMessages.push({ stage, message })
    },
    requestApproval: async (kind, info): Promise<boolean> => {
      approvals.push({ kind, info })
      return true
    },
    shouldCancel: (): boolean => false,
    ...overrides
  }

  return { dependencies, options, progressStages, progressMessages, persistedStates, approvals }
}

const expectedStageOrder: NovelStageName[] = [
  "outline",
  "characters",
  "seeds",
  "chapters",
  "assemble",
  "review",
  "summaries"
]

// With no high-severity findings the revise stage emits no progress but still completes, so a
// resume does not run the review a second time.
const expectedCompletedStages: NovelStageName[] = [
  "outline",
  "characters",
  "seeds",
  "chapters",
  "assemble",
  "review",
  "revise-from-review",
  "summaries"
]

describe("NovelPipeline", () => {
  beforeEach(() => {
    generateDraftMock.mockClear()
    runReviseDraftWorkflowMock.mockClear()
    recordRevisionEntryMock.mockClear()
    summarizeChaptersMock.mockClear()
    checkContinuityMock.mockClear()
    critiqueDraftMock.mockClear()
    saveReviewMock.mockClear()
    generateOutlineSynopsisMock.mockClear()
    saveSynopsisMock.mockClear()
    generateOutlineCharactersMock.mockReset().mockResolvedValue([{ id: "hero", name: "주인공", description: [] }])
    checkContinuityMock.mockResolvedValue([])
    critiqueDraftMock.mockResolvedValue([])
    generateDraftMock.mockResolvedValue(generatedResult)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("emits stage progress in pipeline order and completes", async () => {
    const harness = createHarness()

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")

    const distinctStageOrder = harness.progressStages.filter(
      (stage, index) => stage !== harness.progressStages[index - 1]
    )
    expect(distinctStageOrder).toEqual(expectedStageOrder)
  })

  it("emits one chapters progress event per chapter group", async () => {
    const harness = createHarness()

    await new NovelPipeline(harness.dependencies).run(harness.options)

    const chapterMessages = harness.progressMessages.filter((entry) => entry.stage === "chapters")
    expect(chapterMessages).toHaveLength(2)
    expect(chapterMessages[0]?.message).toContain("1장")
    expect(chapterMessages[1]?.message).toContain("2장")
  })

  it("refreshes the rolling summary after each chapter, not only at the end", async () => {
    const harness = createHarness()

    await new NovelPipeline(harness.dependencies).run(harness.options)

    const chapterIndexes = summarizeChaptersMock.mock.calls
      .map((call) => (call[0] as { chapterIndex?: number }).chapterIndex)
      .filter((chapterIndex) => chapterIndex !== undefined)
    expect(chapterIndexes).toEqual([0, 1])

    // The final summaries stage still runs, resummarizing the whole manuscript.
    expect((summarizeChaptersMock.mock.calls.at(-1)?.[0] as { chapterIndex?: number }).chapterIndex).toBeUndefined()
  })

  it("drafts and revises every scene of every chapter in order", async () => {
    const harness = createHarness()

    await new NovelPipeline(harness.dependencies).run(harness.options)

    const draftedStems = generateDraftMock.mock.calls.map((call) => {
      const { sceneUri } = call[0] as { readonly sceneUri: vscode.Uri }
      return sceneUri.fsPath.split("/").at(-1)
    })
    expect(draftedStems).toEqual(["01-s1.card", "02-s2.card", "03-s3.card"])
    expect(runReviseDraftWorkflowMock).toHaveBeenCalledTimes(3)
    expect(recordRevisionEntryMock).toHaveBeenCalledTimes(3)
  })

  it("persists status done and reports completion message on success", async () => {
    const harness = createHarness()

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    const finalState = harness.persistedStates.at(-1)
    expect(finalState?.status).toBe("done")
    expect(finalState?.completedStages).toEqual(expectedCompletedStages)
  })

  it("skips stages already present in resumeState.completedStages", async () => {
    const resumeState: NovelRunState = {
      version: "1.0.0",
      runId: "run-existing",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runMode: "auto",
      status: "paused",
      completedStages: ["outline", "characters", "seeds", "chapters"],
      nextChapterIndex: 2
    }
    const harness = createHarness({ resumeState })

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    expect(harness.progressStages).toEqual(["assemble", "review", "summaries"])
    expect(generateDraftMock).not.toHaveBeenCalled()
    expect(harness.persistedStates.at(-1)?.runId).toBe("run-existing")
  })

  it("returns cancelled and persists a paused status when shouldCancel becomes true after outline", async () => {
    let cancelRequested = false
    const harness = createHarness({
      shouldCancel: (): boolean => cancelRequested
    })
    harness.options.onProgress = ((stage: NovelStageName, message: string): void => {
      harness.progressStages.push(stage)
      harness.progressMessages.push({ stage, message })
      if (stage === "outline") {
        cancelRequested = true
      }
    }) as NovelPipelineRunOptions["onProgress"]

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("cancelled")
    expect(result.message).toContain("취소")
    expect(harness.progressStages).toEqual(["outline"])
    expect(generateDraftMock).not.toHaveBeenCalled()
    expect(harness.persistedStates.at(-1)?.status).toBe("paused")
  })

  it("pauses before the next scene without advancing past the unfinished chapter", async () => {
    const harness = createHarness({
      shouldPause: (): boolean => generateDraftMock.mock.calls.length >= 1
    })

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("paused")
    expect(generateDraftMock).toHaveBeenCalledTimes(1)
    expect(summarizeChaptersMock).not.toHaveBeenCalled()
    expect(harness.persistedStates.at(-1)).toMatchObject({ status: "paused", nextChapterIndex: 0 })
  })

  it("pauses between chapters with the finished chapter recorded", async () => {
    const harness = createHarness({
      shouldPause: (): boolean => generateDraftMock.mock.calls.length >= 2
    })

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("paused")
    expect(generateDraftMock).toHaveBeenCalledTimes(2)
    expect(harness.persistedStates.at(-1)).toMatchObject({ status: "paused", nextChapterIndex: 1 })
  })

  it("pauses at outline approval when the user declines in non-auto mode", async () => {
    const harness = createHarness({
      runMode: "outline-approval",
      requestApproval: async (): Promise<boolean> => false
    })

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("paused")
    expect(harness.progressStages).toEqual(["outline"])
    expect(harness.persistedStates.at(-1)?.status).toBe("paused")
  })

  // 계약의 장 수를 바꾼 뒤 다시 돌리면 예전에는 경고 없이 옛 계획으로 돌았다. 돈이 드는 실행이라 거부한다.
  it("refuses to run a kept chapter plan whose chapter count the contract no longer matches", async () => {
    const harness = createHarness({ project: { ...project, setting: { chapterCount: 3 } } })
    harness.dependencies.outlineRepository.hasChapterPlan = async (): Promise<boolean> => true

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("failed")
    expect(result.message).toBe(
      "계약은 3장인데 장 계획(outline/chapters.yaml)은 2장입니다. 계약의 장 수를 계획에 맞추거나, 계획을 새로 만들려면 outline/chapters.yaml 을 지우고 다시 돌리세요."
    )
    expect(generateOutlineSynopsisMock).not.toHaveBeenCalled()
  })

  // 모델이 계약의 장 수를 어긴 계획은 예전에는 그대로 저장돼 다음 실행마다 거부당했다. 저장 전에 돌려보낸다.
  it("refuses to save a generated chapter plan whose chapter count the contract did not get", async () => {
    const harness = createHarness({ project: { ...project, setting: { chapterCount: 3 } } })
    harness.dependencies.aiGateway.createService = (() => ({
      generateOutlineSynopsis: async (): Promise<unknown> => generateOutlineSynopsisMock(),
      generateChapterPlan: async (): Promise<ChapterPlan> => samplePlan
    })) as never
    const save = vi.fn()
    harness.dependencies.outlineRepository.save = save

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("failed")
    expect(result.message).toBe(
      "계약은 3장인데 모델이 만든 장 계획은 2장입니다. 계획은 저장하지 않았습니다. 다시 돌리거나 계약의 장 수를 바꾸세요."
    )
    expect(save).not.toHaveBeenCalled()
  })

  // 손으로 쓴 장 계획이나 시놉시스만 지운 작품: 예전에는 계획만 보고 시놉시스를 영영 만들지 않았다.
  it("writes the synopsis a hand-written chapter plan lacks, without a new plan", async () => {
    const harness = createHarness()
    harness.dependencies.outlineRepository.hasChapterPlan = async (): Promise<boolean> => true

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    expect(generateOutlineSynopsisMock).toHaveBeenCalledTimes(1)
    expect(saveSynopsisMock).toHaveBeenCalledTimes(1)

    harness.dependencies.outlineRepository.loadSynopsis = async (): Promise<unknown> => ({ logline: "있음" })
    await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(generateOutlineSynopsisMock).toHaveBeenCalledTimes(1)
  })

  // 예전에는 모델이 돌려주지 않은 인물도 조용히 넘어가 단계가 완료로 남았다.
  it("tells which cast the model left out and fails when it answered for nobody", async () => {
    const plan: ChapterPlan = {
      ...samplePlan,
      acts: [
        {
          ...samplePlan.acts[0]!,
          chapters: [
            {
              ...samplePlan.acts[0]!.chapters[0]!,
              scenes: [{ id: "s1", title: "씬1", purpose: "", characters: ["hero", "jun", "민수"], foreshadowing: [], neededCanon: [] }]
            }
          ]
        }
      ]
    }
    const harness = createHarness()
    harness.dependencies.outlineRepository.loadChapterPlan = async (): Promise<ChapterPlan> => plan
    harness.dependencies.outlineRepository.loadCharacterBriefs = async (): Promise<unknown[]> => []

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    expect(harness.progressMessages.filter((entry) => entry.stage === "characters").map((entry) => entry.message)).toEqual([
      "인물 카드 확인 중…",
      "인물 카드 1장을 만들었습니다.",
      "모델이 카드를 돌려주지 않은 인물이 있습니다: jun. 카드를 직접 만들어 주세요.",
      "카드 이름이 될 수 없는 인물 id 라 카드를 만들지 않았습니다: 민수. outline/chapters.yaml 의 id 를 영소문자로 고쳐 주세요."
    ])

    generateOutlineCharactersMock.mockResolvedValue([])
    const failed = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(failed.outcome).toBe("failed")
    expect(failed.message).toContain("인물 카드를 하나도 만들지 못했습니다: hero")
  })

  it("returns failed and records lastError when a draft fails", async () => {
    generateDraftMock.mockResolvedValueOnce({
      ok: false,
      kind: "failed",
      message: "초안 실패"
    } as never)
    const harness = createHarness()

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("failed")
    expect(result.message).toContain("초안")
    const finalState = harness.persistedStates.at(-1)
    expect(finalState?.status).toBe("failed")
    expect(finalState?.lastError).toBeDefined()
  })

  describe("review feedback", () => {
    // 한 번의 검수가 도는 호출 수 = 조립된 장 수(위 assembleManuscript 모의가 2장을 낸다).
    const callsPerReview = 2

    const highContinuityIssue = {
      start: 0,
      end: 3,
      original: "열여덟 살",
      reason: "설정은 17세다",
      severity: "high",
      sceneStem: "02-s2"
    }

    it("rewrites only the scenes the review named, once each", async () => {
      checkContinuityMock.mockResolvedValueOnce([highContinuityIssue])
      const harness = createHarness()

      await new NovelPipeline(harness.dependencies).run(harness.options)

      const reviseFromReview = runReviseDraftWorkflowMock.mock.calls.filter(
        (call) => (call[0] as { maxIterations: number }).maxIterations === 1
      )
      expect(reviseFromReview).toHaveLength(1)
      expect((reviseFromReview[0]?.[0] as { sceneStem: string }).sceneStem).toBe("02-s2")
      expect(
        (reviseFromReview[0]?.[0] as { seedIssues: { continuityIssues: unknown[] } }).seedIssues
          .continuityIssues
      ).toEqual([highContinuityIssue])
    })

    it("reviews the volume again after rewriting so the report matches the shipped text", async () => {
      checkContinuityMock.mockResolvedValueOnce([highContinuityIssue])
      runReviseDraftWorkflowMock.mockResolvedValue({
        passed: true,
        revisionCount: 1,
        remainingBlocking: 0,
        cancelled: false,
        instructions: []
      })
      const harness = createHarness()

      await new NovelPipeline(harness.dependencies).run(harness.options)

      expect(checkContinuityMock).toHaveBeenCalledTimes(callsPerReview * 2)
      expect(saveReviewMock.mock.calls.at(-1)?.[0]).toContain("재작성한 씬: 02-s2")
    })

    it("skips the rewrite entirely when the review found no high issues", async () => {
      const harness = createHarness()

      await new NovelPipeline(harness.dependencies).run(harness.options)

      expect(checkContinuityMock).toHaveBeenCalledTimes(callsPerReview)
      expect(
        runReviseDraftWorkflowMock.mock.calls.filter(
          (call) => (call[0] as { maxIterations: number }).maxIterations === 1
        )
      ).toHaveLength(0)
    })

    it("reports a high issue that named no draft instead of dropping it", async () => {
      checkContinuityMock.mockResolvedValueOnce([
        { ...highContinuityIssue, sceneStem: "99-unknown" }
      ])
      const harness = createHarness()

      await new NovelPipeline(harness.dependencies).run(harness.options)

      expect(checkContinuityMock).toHaveBeenCalledTimes(callsPerReview)
      expect(saveReviewMock.mock.calls.at(-1)?.[0]).toContain(
        "씬을 특정하지 못해 재작성하지 못한 high 이슈: 1건"
      )
    })

    it("pauses for approval before rewriting in review-approval mode", async () => {
      checkContinuityMock.mockResolvedValueOnce([highContinuityIssue])
      const harness = createHarness({ runMode: "review-approval" })

      const result = await new NovelPipeline(harness.dependencies).run(harness.options)

      expect(result.outcome).toBe("completed")
      expect(harness.approvals.map((approval) => approval.kind)).toContain("review")
      expect(harness.approvals.at(-1)?.info).toContain("02-s2")
    })

    it("stops without rewriting when review approval is declined", async () => {
      checkContinuityMock.mockResolvedValueOnce([highContinuityIssue])
      const harness = createHarness({
        runMode: "review-approval",
        requestApproval: async (): Promise<boolean> => false
      })

      const result = await new NovelPipeline(harness.dependencies).run(harness.options)

      expect(result.outcome).toBe("paused")
      expect(
        runReviseDraftWorkflowMock.mock.calls.filter(
          (call) => (call[0] as { maxIterations: number }).maxIterations === 1
        )
      ).toHaveLength(0)
    })
  })
})

describe("NovelPipeline — 단계 계획", () => {
  afterEach(() => {
    resetNovelPipelinePlan()
  })

  it("runs the bundled stage order when nothing is laid over it", () => {
    expect(resolveNovelPipelinePlan()).toEqual(novelStageNames)
  })

  it("runs only the stages the plan names and records only those as completed", async () => {
    const harness = createHarness({ stages: ["outline", "seeds", "chapters", "summaries"] })

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    expect(harness.progressStages).not.toContain("assemble")
    expect(harness.progressStages).not.toContain("review")
    expect(saveReviewMock).not.toHaveBeenCalled()
    expect(harness.persistedStates.at(-1)?.completedStages).toEqual([
      "outline",
      "seeds",
      "chapters",
      "summaries"
    ])
  })

  it("takes the order from a spec laid over the bundled one and refuses one that drops the chapters", async () => {
    overrideNovelPipelinePlan({
      version: 1,
      stages: ["outline", "characters", "seeds", "chapters", { id: "assemble", enabled: false }, "summaries"]
    })
    const harness = createHarness()

    const result = await new NovelPipeline(harness.dependencies).run(harness.options)

    expect(result.outcome).toBe("completed")
    expect(harness.progressStages).toEqual([
      "outline",
      "characters",
      "seeds",
      "chapters",
      "chapters",
      "summaries"
    ])
    expect(() =>
      overrideNovelPipelinePlan({ version: 1, stages: ["outline", "characters", "seeds", "summaries"] })
    ).toThrow("chapters")
  })
})
