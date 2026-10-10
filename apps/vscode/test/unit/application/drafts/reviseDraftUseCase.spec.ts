import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AiProviderError, type ContinuityIssueLike, type DraftCritiqueIssue } from '@storyboard/story-model';

const checkContinuityMock = vi.fn<[], Promise<ContinuityIssueLike[]>>()
const critiqueDraftMock = vi.fn(async (input: unknown): Promise<DraftCritiqueIssue[]> => {
  void input
  return []
})
const reviseDraftMock = vi.fn(async (input: unknown): Promise<string> => {
  void input
  return "인물은 창가에서 잠시 숨을 골랐다."
})
const writeDraftFileMock = vi.fn(async () => undefined)
const loggerInfoMock = vi.fn()
const fileWriteMock = vi.fn<[unknown, Uint8Array], Promise<undefined>>(async () => undefined)

vi.mock("@storyboard/story-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-ai")>()),
  StoryboardAiService: class {
    checkContinuity = (): Promise<ContinuityIssueLike[]> => checkContinuityMock()
    critiqueDraft = (input: unknown): Promise<DraftCritiqueIssue[]> => critiqueDraftMock(input)
    reviseDraft = (input: unknown): Promise<string> => reviseDraftMock(input)
  }
}))
vi.mock("@storyboard/story-model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-model")>()),
  readSceneFile: async (): Promise<unknown> => ({
    stem: "01-scene",
    order: 1,
    orderText: "01",
    slug: "scene",
    frontmatter: {},
    body: "씬 의도",
    card: {
      beats: [
        { text: "아침을 먹는다", place: "거실", time: "아침", cast: ["hero"] },
        { text: "하교한다", place: "교문 앞", time: "방과 후" }
      ]
    }
  }),
  parseDraft: (): unknown => ({ format: "novel", body: "원본 본문" }),
  createDraft: (input: unknown): unknown => input,
  readDraftFile: async (): Promise<string> => "raw",
  writeDraftFile: (...args: unknown[]): unknown => writeDraftFileMock(...args),
  buildSceneContext: async (): Promise<unknown> => ({
    scene: { body: "씬 의도" },
    characters: [
      {
        type: "character",
        id: "hero",
        name: "주인공",
        role: "main",
        voice: ["짧은 존댓말"]
      }
    ]
  }),
  buildNarrativeContext: async (): Promise<unknown> => ({ bibleFacts: [] }),
  formatBibleFactLines: (): unknown[] => []
}))
import {
  describeReviseOutcome,
  ReviseDraftUseCase,
  type ReviseDraftRequest,
  type ReviseDraftUseCaseDependencies,
  type ReviseDraftWorkflowResult
} from "@storyboard/story-engine"

const blockingContinuity: ContinuityIssueLike = { original: "설정", reason: "모순", severity: "high" }
const lowContinuity: ContinuityIssueLike = { original: "설정", reason: "사소함", severity: "low" }
const highCritique: DraftCritiqueIssue = { category: "voice", severity: "high", comment: "보이스 문제" }

function baseOptions(
  overrides: Partial<ReviseDraftRequest> = {}
): ReviseDraftUseCaseDependencies & ReviseDraftRequest {
  return {
    aiProviderRegistry: {
      getTaskProvider: () => "mock",
      getTaskAiConfig: () => ({ providerId: "mock", model: "mock-model" })
    } as never,
    usageRecorder: {} as never,
    logger: { error: () => undefined, info: loggerInfoMock, warn: () => undefined } as never,
    fileSystem: { createDirectory: async () => undefined, writeFile: fileWriteMock, exists: async () => false } as never,
    generator: "storyboard@0.0.0-test",
    workspaceUri: vscode.Uri.file("/ws/project"),
    paths: {
      sceneDirectory: vscode.Uri.file("/ws/project/scene"),
      draftDirectory: vscode.Uri.file("/ws/project/draft"),
      manuscriptDirectory: vscode.Uri.file("/ws/project/manuscript"),
      characterDirectory: vscode.Uri.file("/ws/project/character"),
      backgroundDirectory: vscode.Uri.file("/ws/project/background"),
      bibleCanon: vscode.Uri.file("/ws/project/.storyboard/bible/canon.yaml"),
      projectJson: vscode.Uri.file("/ws/project/.storyboard/project.json"),
      revisionRoundsDirectory: vscode.Uri.file("/ws/project/.storyboard/cache/revisions")
    } as never,
    draftUri: vscode.Uri.file("/ws/project/draft/01-scene.md"),
    sceneStem: "01-scene",
    maxIterations: 2,
    maxCompressionPercent: 50,
    reviseScoreThreshold: 0,
    ...overrides
  }
}

async function runReviseDraftWorkflow(
  options: ReviseDraftUseCaseDependencies & ReviseDraftRequest
): Promise<ReviseDraftWorkflowResult> {
  return await new ReviseDraftUseCase(options).execute(options)
}

describe("ReviseDraftUseCase", () => {
  beforeEach(() => {
    checkContinuityMock.mockReset()
    critiqueDraftMock.mockReset()
    reviseDraftMock.mockClear()
    writeDraftFileMock.mockClear()
    loggerInfoMock.mockClear()
    fileWriteMock.mockClear()
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

  it("reviews against the scene coordinates the generation recorded", async () => {
    const sceneCacheRepository = {
      read: vi.fn(async () => ({ sceneCoordinates: ["1. 시각: 아침 / 장소: 거실 / 있는 사람: 주인공"] })),
      write: vi.fn(async () => undefined),
      ensureDirectory: vi.fn(async () => undefined)
    }
    const options = baseOptions()

    await runReviseDraftWorkflow({
      ...options,
      paths: { ...(options.paths as object), sceneCacheDirectory: vscode.Uri.file("/ws/project/.storyboard/cache/scenes") } as never,
      fileSystem: { ...(options.fileSystem as object), exists: async () => true } as never,
      sceneCacheRepository: sceneCacheRepository as never
    })

    const facts = (critiqueDraftMock.mock.calls[0]?.[0] as { facts: readonly string[] }).facts
    expect(facts).toContain("장면 좌표 1. 시각: 아침 / 장소: 거실 / 있는 사람: 주인공")
  })

  it("falls back to the beat coordinates when no generation record exists", async () => {
    await runReviseDraftWorkflow(baseOptions())

    const facts = (critiqueDraftMock.mock.calls[0]?.[0] as { facts: readonly string[] }).facts
    expect(facts).toEqual(
      expect.arrayContaining([
        "장면 좌표 1. 출연: 주인공 / 장소: 거실 / 시각: 아침",
        "장면 좌표 2. 장소: 교문 앞 / 시각: 방과 후"
      ])
    )
  })

  // #114: 초안은 이미 디스크에 있으므로 감수 중 프로바이더 타임아웃은 던지지 않고 결과로 돌려준다.
  it("returns a timed-out rewrite as a failure instead of throwing", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    reviseDraftMock.mockRejectedValueOnce(
      new AiProviderError("cli-timeout", "claude-code", "600초 안에 끝나지 않아 중단했습니다.")
    )

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.failure).toEqual({
      stage: "revise",
      kind: "timeout",
      message: "600초 안에 끝나지 않아 중단했습니다."
    })
    expect(result.revisionCount).toBe(0)
    expect(writeDraftFileMock).not.toHaveBeenCalled()
    expect(describeReviseOutcome(result)).toMatchObject({ status: "timeout", revisionCount: 0 })
    expect(describeReviseOutcome(result).warning).toContain("초안은 생성된 그대로입니다")
  })

  it("keeps the rewrites already accepted when a later check fails", async () => {
    checkContinuityMock
      .mockResolvedValueOnce([blockingContinuity])
      .mockRejectedValueOnce(new AiProviderError("connection-failed", "claude", "연결 끊김"))

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.failure).toMatchObject({ stage: "check", kind: "provider" })
    expect(result.revisionCount).toBe(1)
    expect(writeDraftFileMock).toHaveBeenCalledTimes(1)
    expect(describeReviseOutcome(result).status).toBe("failed")
  })

  it("still throws an error that is not a provider failure", async () => {
    checkContinuityMock.mockRejectedValueOnce(new TypeError("bug"))

    await expect(runReviseDraftWorkflow(baseOptions())).rejects.toThrow("bug")
  })

  // #113: 앞 회차가 무엇을 잡고 재작성이 무엇을 받았는지 남긴다.
  it("records every round in the cache and logs one line per round", async () => {
    checkContinuityMock.mockResolvedValueOnce([blockingContinuity]).mockResolvedValue([])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.rounds.map((round) => round.round)).toEqual([1, 2])
    expect(result.rounds[0]?.rewrite?.acceptedSections).toEqual([0])
    const [uri, content] = fileWriteMock.mock.calls.at(-1) ?? []
    expect(String((uri as { path: string }).path)).toContain(".storyboard/cache/revisions/01-scene.json")
    const record = JSON.parse(new TextDecoder().decode(content)) as { rounds: unknown[] }
    expect(record.rounds).toHaveLength(2)
    expect(loggerInfoMock.mock.calls.map((call) => call[0])).toEqual([
      "01-scene: 검사 1: 연속성 1건(높음 1) · 비평 0건 · 차단 1 → 재작성 1구간 중 1구간 반영",
      "01-scene: 검사 2: 연속성 0건(높음 0) · 비평 0건 · 차단 0 → 통과"
    ])
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

  it("passes character cards to both critique and revision", async () => {
    critiqueDraftMock.mockResolvedValueOnce([highCritique]).mockResolvedValue([])

    await runReviseDraftWorkflow(baseOptions({ maxIterations: 1 }))

    const critiqueInput = critiqueDraftMock.mock.calls[0]?.[0] as {
      readonly characterCards: readonly string[]
    }
    const revisionInput = reviseDraftMock.mock.calls[0]?.[0] as {
      readonly characterCards: readonly string[]
    }

    expect(critiqueInput.characterCards).toEqual([
      "[주인공] 역할: main\n말투: 짧은 존댓말"
    ])
    expect(revisionInput.characterCards).toEqual(critiqueInput.characterCards)
  })

  it("Q6: stops at maxIterations and reports remaining blocking when issues persist", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    critiqueDraftMock.mockResolvedValue([highCritique])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(2)
    expect(result.remainingBlocking).toBeGreaterThanOrEqual(1)
    // 모든 타깃 지시를 한 번의 전체 재작성에 통합한다.
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

  it("preserves the original draft when a revision candidate is too short", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    reviseDraftMock.mockResolvedValueOnce("끝.")

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.preservedOriginal).toBe(true)
    expect(result.rejection).toMatchObject({ reason: "too-short", candidateLength: 2 })
    expect(result.revisionCount).toBe(0)
    expect(writeDraftFileMock).not.toHaveBeenCalled()
    expect(checkContinuityMock).toHaveBeenCalledTimes(1)
  })

  it("does not write an earlier valid candidate when a later candidate is rejected", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    reviseDraftMock
      .mockResolvedValueOnce("인물은 창가에서 오래 숨을 골랐다.")
      .mockResolvedValueOnce("끝.")

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.preservedOriginal).toBe(true)
    expect(result.revisionCount).toBe(1)
    expect(writeDraftFileMock).not.toHaveBeenCalled()
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

  it("G-3: makes one scoped revision call when only a single agent is targeted", async () => {
    checkContinuityMock.mockResolvedValueOnce([blockingContinuity]).mockResolvedValue([])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(1)
    // continuity 단독 → canon 그룹 1개 → 스코프 호출 1회.
    expect(reviseDraftMock).toHaveBeenCalledTimes(1)
  })

  it("G-3: combines canon/persona/narrator instructions into one revision call", async () => {
    const purposeCritique: DraftCritiqueIssue = { category: "purpose", severity: "high", comment: "목적 미달" }
    checkContinuityMock.mockResolvedValueOnce([blockingContinuity]).mockResolvedValue([])
    critiqueDraftMock.mockResolvedValueOnce([highCritique, purposeCritique]).mockResolvedValue([])

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2 }))

    expect(result.passed).toBe(true)
    expect(result.revisionCount).toBe(1)
    expect(reviseDraftMock).toHaveBeenCalledTimes(1)
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

  it("cancels as the revision phase begins without applying or writing", async () => {
    checkContinuityMock.mockResolvedValue([blockingContinuity])
    critiqueDraftMock.mockResolvedValue([highCritique])
    let cancelChecks = 0
    const shouldCancel = (): boolean => {
      cancelChecks += 1
      return cancelChecks > 2
    }

    const result = await runReviseDraftWorkflow(baseOptions({ maxIterations: 2, shouldCancel }))

    expect(result.cancelled).toBe(true)
    expect(result.passed).toBe(false)
    expect(result.revisionCount).toBe(0)
    expect(reviseDraftMock).not.toHaveBeenCalled()
    expect(writeDraftFileMock).not.toHaveBeenCalled()
  })
})
