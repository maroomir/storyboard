import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import {
  ReviewManuscriptUseCase,
  type IManuscriptReviewRepository,
  type ManuscriptReviewSource
} from "@/application/manuscript/reviewManuscriptUseCase"
import type { ChapterPlan } from '@storyboard/story-format';

const plan: ChapterPlan = {
  version: "1.0.0",
  acts: [
    {
      id: "act-1",
      title: "발단",
      chapters: [
        {
          id: "chapter-1",
          title: "1장",
          scenes: [
            { id: "opening", title: "시작", purpose: "", characters: ["hero"], foreshadowing: [] }
          ]
        }
      ]
    }
  ]
}

function reviewSource(draftCount = 1): ManuscriptReviewSource {
  return {
    source: {
      projectName: "테스트",
      plan,
      draftsByOrder:
        draftCount > 0 ? new Map([[1, { stem: "01-opening", body: "본문" }]]) : new Map()
    },
    styleConstraints: ["문장은 간결하게"],
    qualityCriteria: ["갈등을 분명히"],
    canonFactLines: ["hero — 이름: 홍길동"]
  }
}

function repository(overrides: Partial<IManuscriptReviewRepository> = {}): IManuscriptReviewRepository {
  return {
    hasChapterPlan: vi.fn(async () => true),
    loadReviewSource: vi.fn(async () => reviewSource()),
    saveReview: vi.fn(async () => vscode.Uri.file("/workspace/manuscript/REVIEW.md")),
    ...overrides
  }
}

function useCase(
  storage: IManuscriptReviewRepository,
  ai: {
    checkContinuity?: ReturnType<typeof vi.fn>
    critiqueDraft?: ReturnType<typeof vi.fn>
  } = {}
): ReviewManuscriptUseCase {
  const checkContinuity = ai.checkContinuity ?? vi.fn(async () => [])
  const critiqueDraft = ai.critiqueDraft ?? vi.fn(async () => [])
  return new ReviewManuscriptUseCase(
    {
      createService: () => ({ checkContinuity, critiqueDraft }),
      getTaskProvider: () => "mock"
    } as never,
    storage,
    { warn: vi.fn() } as never
  )
}

describe("ReviewManuscriptUseCase", () => {
  it("reports a missing outline before loading source", async () => {
    const storage = repository({ hasChapterPlan: vi.fn(async () => false) })

    await expect(useCase(storage).execute(vscode.Uri.file("/workspace"))).resolves.toEqual({
      kind: "missing_outline",
      ok: false
    })
    expect(storage.loadReviewSource).not.toHaveBeenCalled()
  })

  it("reports missing drafts when no draft was collected", async () => {
    const storage = repository({ loadReviewSource: vi.fn(async () => reviewSource(0)) })

    await expect(useCase(storage).execute(vscode.Uri.file("/workspace"))).resolves.toEqual({
      kind: "missing_drafts",
      ok: false
    })
  })

  it("reviews the manuscript and returns continuity and critique counts", async () => {
    const checkContinuity = vi.fn(async () => [
      { original: "밤", reason: "낮이어야 함", severity: "high" }
    ])
    const critiqueDraft = vi.fn(async () => [
      { category: "voice", severity: "low", comment: "말투" },
      { category: "purpose", severity: "high", comment: "목적" }
    ])
    const storage = repository()

    const result = await useCase(storage, { checkContinuity, critiqueDraft }).execute(
      vscode.Uri.file("/workspace")
    )

    expect(result).toEqual(
      expect.objectContaining({
        kind: "reviewed",
        ok: true,
        continuityCount: 1,
        critiqueCount: 2
      })
    )
    expect(storage.saveReview).toHaveBeenCalledOnce()
  })

  it("returns failed when the AI call rejects", async () => {
    const checkContinuity = vi.fn(async () => {
      throw new Error("provider down")
    })

    const result = await useCase(repository(), { checkContinuity }).execute(
      vscode.Uri.file("/workspace")
    )

    expect(result).toEqual({ kind: "failed", message: "provider down", ok: false })
  })

  it("returns failed when saving the report rejects", async () => {
    const storage = repository({
      saveReview: vi.fn(async () => {
        throw new Error("disk full")
      })
    })

    const result = await useCase(storage).execute(vscode.Uri.file("/workspace"))

    expect(result).toEqual({ kind: "failed", message: "disk full", ok: false })
  })

  it("passes style constraints and quality criteria into the critique", async () => {
    const critiqueDraft = vi.fn(async () => [])

    await useCase(repository(), { critiqueDraft }).execute(vscode.Uri.file("/workspace"))

    expect(critiqueDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        styleConstraints: ["문장은 간결하게"],
        qualityCriteria: ["갈등을 분명히"]
      }),
      expect.anything()
    )
  })
})
