import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ContinuityIssueLike, DraftCritiqueIssue } from "@/shared/draftReview"

const checkContinuityMock = vi.fn<[], Promise<ContinuityIssueLike[]>>()
const critiqueDraftMock = vi.fn<[], Promise<DraftCritiqueIssue[]>>()
const reviseDraftMock = vi.fn(async () => "수정된 본문")
const writeDraftFileMock = vi.fn(async () => undefined)

vi.mock("@/services/ai/AIService", () => ({
  StoryboardAIService: class {
    checkContinuity = (): Promise<ContinuityIssueLike[]> => checkContinuityMock()
    critiqueDraft = (): Promise<DraftCritiqueIssue[]> => critiqueDraftMock()
    reviseDraft = (): Promise<string> => reviseDraftMock()
  }
}))
vi.mock("@/services/ai/recordUsageSafely", () => ({ recordUsageSafely: (): void => undefined }))
vi.mock("@/files/scene", () => ({
  readSceneFile: async (): Promise<unknown> => ({
    stem: "01-scene",
    order: 1,
    orderText: "01",
    slug: "scene",
    frontmatter: {},
    body: "씬 의도"
  })
}))
vi.mock("@/files/projectJson", () => ({
  readProjectJson: async (): Promise<unknown> => ({
    setting: { styleConstraints: [], qualityCriteria: [] }
  })
}))
vi.mock("@/files/draft", () => ({
  parseDraft: (): unknown => ({ format: "novel", body: "원본 본문" }),
  createDraft: (input: unknown): unknown => input,
  readDraftFile: async (): Promise<string> => "raw",
  writeDraftFile: (...args: unknown[]): unknown => writeDraftFileMock(...args)
}))
vi.mock("@/core/sceneContext", () => ({
  buildSceneContext: async (): Promise<unknown> => ({
    scene: { body: "씬 의도" },
    characters: [{ name: "주인공" }]
  }),
  buildNarrativeContext: async (): Promise<unknown> => ({ bibleFacts: [] }),
  formatBibleFactLines: (): unknown[] => []
}))

import { runReviseDraftWorkflow, type ReviseDraftWorkflowOptions } from "@/core/reviseDraftWorkflow"

const blockingContinuity: ContinuityIssueLike = { original: "설정", reason: "모순", severity: "high" }
const lowContinuity: ContinuityIssueLike = { original: "설정", reason: "사소함", severity: "low" }
const highCritique: DraftCritiqueIssue = { category: "voice", severity: "high", comment: "보이스 문제" }

function baseOptions(overrides: Partial<ReviseDraftWorkflowOptions> = {}): ReviseDraftWorkflowOptions {
  return {
    aiProviderRegistry: { getTaskProvider: () => "mock" } as never,
    usageRecorder: {} as never,
    logger: { error: () => undefined } as never,
    workspaceUri: vscode.Uri.file("/ws/project"),
    paths: {
      sceneDirectory: vscode.Uri.file("/ws/project/scene"),
      draftDirectory: vscode.Uri.file("/ws/project/draft"),
      characterDirectory: vscode.Uri.file("/ws/project/character"),
      backgroundDirectory: vscode.Uri.file("/ws/project/background"),
      bibleCanon: vscode.Uri.file("/ws/project/.storyboard/bible/canon.yaml"),
      projectJson: vscode.Uri.file("/ws/project/.storyboard/project.json")
    } as never,
    draftUri: vscode.Uri.file("/ws/project/draft/01-scene.md"),
    sceneStem: "01-scene",
    maxIterations: 2,
    reviseScoreThreshold: 0,
    ...overrides
  }
}

describe("runReviseDraftWorkflow", () => {
  beforeEach(() => {
    checkContinuityMock.mockReset()
    critiqueDraftMock.mockReset()
    reviseDraftMock.mockClear()
    writeDraftFileMock.mockClear()
    checkContinuityMock.mockResolvedValue([])
    critiqueDraftMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("passes on the first check without revising when there are no blocking issues", async () => {
    const result = await runReviseDraftWorkflow(baseOptions())

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(0)
    expect(result.remainingBlocking).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
    expect(writeDraftFileMock).not.toHaveBeenCalled()
  })

  it("Q4: passes without revising when continuity issues are all low severity", async () => {
    checkContinuityMock.mockResolvedValue([lowContinuity])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 3 }))

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(0)
    expect(result.remainingBlocking).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
  })

  it("Q5: revises once then passes when the second check is clean", async () => {
    checkContinuityMock.mockResolvedValueOnce([blockingContinuity]).mockResolvedValue([])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 3 }))

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(1)
    expect(result.remainingBlocking).toBe(0)
    expect(reviseDraftMock).toHaveBeenCalledTimes(1)
    expect(writeDraftFileMock).toHaveBeenCalledTimes(1)
  })

  it("Q6: stops at maxIterations and reports remaining blocking when issues persist", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    critiqueDraftMock.mockResolvedValue([highCritique])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(2)
    expect(result.remainingBlocking).toBeGreaterThanOrEqual(1)
    expect(reviseDraftMock).toHaveBeenCalledTimes(2)
    expect(result.instructions.length).toBeGreaterThan(0)
  })

  it("Q7: never revises when continuity issues stay low across iterations", async () => {
    checkContinuityMock.mockResolvedValue([lowContinuity, lowContinuity])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
  })

  it("checks once and never revises when maxIterations is zero", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 0 }))

    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
    expect(checkContinuityMock).toHaveBeenCalledTimes(1)
  })

  it("does not run any check when cancelled before the loop starts", async () => {
    const result = await runReviseDraftWorkflow(baseOptions({ shouldCancel: () => true }))

    expect(result.cancelled).toBe(true)
    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(0)
    expect(checkContinuityMock).not.toHaveBeenCalled()
    expect(reviseDraftMock).not.toHaveBeenCalled()
  })

  it("counts only high-severity critique issues as blocking", async () => {
    const lowCritique: DraftCritiqueIssue = { category: "repetition", severity: "low", comment: "사소함" }
    critiqueDraftMock.mockResolvedValue([lowCritique])

    const result = await runReviseDraftWorkflow(baseOptions())

    expect(result.passed).toBe(true)
    expect(result.remainingBlocking).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
  })

  it("QAS-C3-12: does not early-pass on a high score when reviseScoreThreshold is 0", async () => {
    const lowCritique: DraftCritiqueIssue = { category: "repetition", severity: "low", comment: "사소함" }
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    critiqueDraftMock.mockResolvedValue([lowCritique])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2, reviseScoreThreshold: 0 }))

    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(2)
    expect(result.remainingBlocking).toBeGreaterThanOrEqual(1)
    expect(reviseDraftMock).toHaveBeenCalledTimes(2)
  })
})
