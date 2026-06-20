import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChapterPlan } from "@/shared/outline"
import type { StoryboardProject } from "@/shared/project"
import type { NovelRunState, NovelStageName } from "@/files/novelRunState"
import { parseNovelRunState } from "@/files/novelRunState"
import { serializeChapterPlan } from "@/files/outline"
import { workspace } from "../../stubs/vscode"

const generateDraftMock = vi.fn(async () => ({ ok: true, kind: "generated" }) as const)
const runReviseDraftWorkflowMock = vi.fn(async () => ({
  passed: true,
  revisionCount: 0,
  remainingBlocking: 0,
  cancelled: false,
  instructions: [] as string[]
}))
const recordRevisionEntryMock = vi.fn(async () => undefined)

vi.mock("@/commands/generateDraft", () => ({
  generateDraftForWorkspaceSceneWorkflow: (...args: unknown[]): unknown => generateDraftMock(...args)
}))
vi.mock("@/core/reviseDraftWorkflow", () => ({
  runReviseDraftWorkflow: (...args: unknown[]): unknown => runReviseDraftWorkflowMock(...args)
}))
vi.mock("@/core/revisionPlanRecorder", () => ({
  recordRevisionEntry: (...args: unknown[]): unknown => recordRevisionEntryMock(...args)
}))
vi.mock("@/core/characterBriefs", () => ({ listCharacterBriefs: async (): Promise<unknown[]> => [] }))
vi.mock("@/core/manuscriptDrafts", () => ({ collectDraftsByOrder: async (): Promise<unknown[]> => [] }))
vi.mock("@/core/manuscriptAssembly", () => ({
  assembleManuscript: (): unknown => ({ chapters: [], volumeMarkdown: "", includedCount: 0 })
}))
vi.mock("@/core/manuscriptReview", () => ({ buildManuscriptReviewMarkdown: (): string => "" }))
vi.mock("@/core/chapterSummaries", () => ({ buildChapterSummariesMarkdown: (): string => "" }))
vi.mock("@/core/foreshadowingTracker", () => ({
  collectForeshadowing: (): unknown[] => [],
  buildForeshadowingMarkdown: (): string => ""
}))
vi.mock("@/services/ai/recordUsageSafely", () => ({ recordUsageSafely: (): void => undefined }))
vi.mock("@/services/ai/AIService", () => ({
  StoryboardAIService: class {
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

import { runNovelPipeline, type NovelPipelineOptions } from "@/core/novelPipeline"

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
const novelRunStatePath = vscode.Uri.joinPath(workspaceUri, ".storyboard", "cache", "novel-run.json").fsPath
const chaptersPath = vscode.Uri.joinPath(workspaceUri, ".storyboard", "outline", "chapters.yaml").fsPath

function chaptersYamlBytes(plan: ChapterPlan): Uint8Array {
  return new TextEncoder().encode(serializeChapterPlan(plan))
}

interface PipelineHarness {
  readonly options: NovelPipelineOptions
  readonly progressStages: NovelStageName[]
  readonly progressMessages: { stage: NovelStageName; message: string }[]
  readonly persistedStates: NovelRunState[]
  readonly approvals: { kind: string; info: string }[]
}

function createHarness(overrides: Partial<NovelPipelineOptions> = {}): PipelineHarness {
  const progressStages: NovelStageName[] = []
  const progressMessages: { stage: NovelStageName; message: string }[] = []
  const persistedStates: NovelRunState[] = []
  const approvals: { kind: string; info: string }[] = []

  workspace.fs.readFile = async (uri): Promise<Uint8Array> => {
    if (uri.fsPath === chaptersPath) {
      return chaptersYamlBytes(samplePlan)
    }
    throw new Error(`unexpected read: ${uri.fsPath}`)
  }
  ;(workspace.fs as Record<string, unknown>).writeFile = async (
    uri: vscode.Uri,
    content: Uint8Array
  ): Promise<void> => {
    if (uri.fsPath === novelRunStatePath) {
      persistedStates.push(parseNovelRunState(new TextDecoder().decode(content)))
    }
  }
  ;(workspace.fs as Record<string, unknown>).createDirectory = async (): Promise<void> => undefined
  ;(workspace as Record<string, unknown>).getConfiguration = (): { inspect: () => undefined } => ({
    inspect: () => undefined
  })
  workspace.getWorkspaceFolder = (): undefined => undefined

  const options: NovelPipelineOptions = {
    workspaceUri,
    project,
    deps: {
      aiProviderRegistry: { getTaskProvider: () => "mock" } as never,
      configBridge: {} as never,
      logger: { error: () => undefined, info: () => undefined } as never,
      usageRecorder: {} as never
    },
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

  return { options, progressStages, progressMessages, persistedStates, approvals }
}

const expectedStageOrder: NovelStageName[] = [
  "outline",
  "seeds",
  "chapters",
  "assemble",
  "review",
  "summaries"
]

describe("runNovelPipeline", () => {
  beforeEach(() => {
    generateDraftMock.mockClear()
    runReviseDraftWorkflowMock.mockClear()
    recordRevisionEntryMock.mockClear()
    generateDraftMock.mockResolvedValue({ ok: true, kind: "generated" })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("emits stage progress in pipeline order and completes", async () => {
    const harness = createHarness()

    const result = await runNovelPipeline(harness.options)

    expect(result.outcome).toBe("completed")

    const distinctStageOrder = harness.progressStages.filter(
      (stage, index) => stage !== harness.progressStages[index - 1]
    )
    expect(distinctStageOrder).toEqual(expectedStageOrder)
  })

  it("emits one chapters progress event per chapter group", async () => {
    const harness = createHarness()

    await runNovelPipeline(harness.options)

    const chapterMessages = harness.progressMessages.filter((entry) => entry.stage === "chapters")
    expect(chapterMessages).toHaveLength(2)
    expect(chapterMessages[0]?.message).toContain("1장")
    expect(chapterMessages[1]?.message).toContain("2장")
  })

  it("drafts and revises every scene of every chapter in order", async () => {
    const harness = createHarness()

    await runNovelPipeline(harness.options)

    const draftedStems = generateDraftMock.mock.calls.map((call) => {
      const sceneUri = call[0] as vscode.Uri
      return sceneUri.fsPath.split("/").at(-1)
    })
    expect(draftedStems).toEqual(["01-s1.txt", "02-s2.txt", "03-s3.txt"])
    expect(runReviseDraftWorkflowMock).toHaveBeenCalledTimes(3)
    expect(recordRevisionEntryMock).toHaveBeenCalledTimes(3)
  })

  it("persists status done and reports completion message on success", async () => {
    const harness = createHarness()

    const result = await runNovelPipeline(harness.options)

    expect(result.outcome).toBe("completed")
    const finalState = harness.persistedStates.at(-1)
    expect(finalState?.status).toBe("done")
    expect(finalState?.completedStages).toEqual(expectedStageOrder)
  })

  it("skips stages already present in resumeState.completedStages", async () => {
    const resumeState: NovelRunState = {
      version: "1.0.0",
      runId: "run-existing",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runMode: "auto",
      status: "paused",
      completedStages: ["outline", "seeds", "chapters"],
      nextChapterIndex: 2
    }
    const harness = createHarness({ resumeState })

    const result = await runNovelPipeline(harness.options)

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
    }) as NovelPipelineOptions["onProgress"]

    const result = await runNovelPipeline(harness.options)

    expect(result.outcome).toBe("cancelled")
    expect(result.message).toContain("취소")
    expect(harness.progressStages).toEqual(["outline"])
    expect(generateDraftMock).not.toHaveBeenCalled()
    expect(harness.persistedStates.at(-1)?.status).toBe("paused")
  })

  it("pauses at outline approval when the user declines in non-auto mode", async () => {
    const harness = createHarness({
      runMode: "outline-approval",
      requestApproval: async (): Promise<boolean> => false
    })

    const result = await runNovelPipeline(harness.options)

    expect(result.outcome).toBe("paused")
    expect(harness.progressStages).toEqual(["outline"])
    expect(harness.persistedStates.at(-1)?.status).toBe("paused")
  })

  it("returns failed and records lastError when a draft fails", async () => {
    generateDraftMock.mockResolvedValueOnce({
      ok: false,
      kind: "failed",
      message: "초안 실패"
    } as never)
    const harness = createHarness()

    const result = await runNovelPipeline(harness.options)

    expect(result.outcome).toBe("failed")
    expect(result.message).toContain("초안")
    const finalState = harness.persistedStates.at(-1)
    expect(finalState?.status).toBe("failed")
    expect(finalState?.lastError).toBeDefined()
  })
})
