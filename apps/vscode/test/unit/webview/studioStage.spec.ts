import { describe, expect, it } from "vitest"

import { formatRelativeDay, stageFacts, stageTitle } from "@webview/lib/studioStage"
import type { StudioCardStage, StudioSceneStage, StudioTarget } from "@webview/lib/types"

const sceneTarget: StudioTarget = {
  kind: "scene",
  label: "03-first-day.txt",
  sceneUri: "file:///scene/03-first-day.txt",
  hasSelection: false
}

function buildStage(overrides: Partial<StudioSceneStage> = {}): StudioSceneStage {
  return {
    kind: "scene",
    sceneStem: "03-first-day",
    title: "첫 등교",
    draftLength: 1240,
    draftUpdatedAt: "2026-08-06T09:00:00.000Z",
    draftRevision: 2,
    review: "unreviewed",
    cards: [],
    ...overrides
  }
}

const now = new Date("2026-08-07T09:00:00.000Z")

describe("stageTitle", () => {
  it("names the scene by its order and seed title", () => {
    expect(stageTitle(sceneTarget, buildStage())).toBe("씬 03 · 첫 등교")
  })

  it("falls back to the scene stem when the seed has no title", () => {
    expect(stageTitle(sceneTarget, buildStage({ title: undefined }))).toBe("씬 03 · 03-first-day")
  })

  it("falls back to the target label before the stage arrives", () => {
    expect(stageTitle(sceneTarget)).toBe("씬 · 03-first-day.txt")
    expect(stageTitle({ kind: "none", hasSelection: false })).toBe("열린 대상 없음")
  })
})

describe("stageFacts", () => {
  it("summarizes length, revision, recency, and review state", () => {
    expect(stageFacts(buildStage(), now)).toEqual(["1,240자", "초안 v2", "어제", "검수 전"])
  })

  it("omits the revision number when no history is archived", () => {
    expect(stageFacts(buildStage({ draftRevision: undefined }), now)).toEqual([
      "1,240자",
      "초안",
      "어제",
      "검수 전"
    ])
  })

  it("reports a missing draft as the only fact", () => {
    expect(stageFacts(buildStage({ draftUpdatedAt: undefined }), now)).toEqual(["초안 없음"])
  })

  it("distinguishes a clean review from one with issues", () => {
    expect(stageFacts(buildStage({ review: "clean" }), now).at(-1)).toBe("검수 통과")
    expect(stageFacts(buildStage({ review: "issues" }), now).at(-1)).toBe("검수 이슈")
  })

  it("returns nothing before the stage arrives", () => {
    expect(stageFacts(undefined, now)).toEqual([])
  })
})

function isoDaysBefore(days: number): string {
  const earlier = new Date(now)
  earlier.setDate(earlier.getDate() - days)
  return earlier.toISOString()
}

describe("formatRelativeDay", () => {
  it("labels the same calendar day as today", () => {
    expect(formatRelativeDay(isoDaysBefore(0), now)).toBe("오늘")
  })

  it("counts whole calendar days back", () => {
    expect(formatRelativeDay(isoDaysBefore(3), now)).toBe("3일 전")
  })

  it("returns an empty label for an unparsable date", () => {
    expect(formatRelativeDay("not-a-date", now)).toBe("")
  })
})

function buildCardStage(overrides: Partial<StudioCardStage> = {}): StudioCardStage {
  return {
    kind: "card",
    cardKind: "character",
    cardId: "seorin",
    name: "서린",
    role: "main",
    relations: [{ target: "jiho", type: "소꿉친구" }],
    appearsInScenes: ["01-intro", "03-first-day"],
    ...overrides
  }
}

const characterTarget: StudioTarget = {
  kind: "character",
  label: "seorin.card",
  entity: { kind: "character", key: "seorin" },
  hasSelection: false
}

describe("card stages", () => {
  it("names a character card by its kind and name", () => {
    expect(stageTitle(characterTarget, buildCardStage())).toBe("인물 · 서린")
  })

  it("names a background card by its kind and name", () => {
    expect(stageTitle(characterTarget, buildCardStage({ cardKind: "background", name: "지하철" }))).toBe(
      "배경 · 지하철"
    )
  })

  it("summarizes the role, scene appearances and relations", () => {
    expect(stageFacts(buildCardStage())).toEqual(["주연", "등장 씬 2", "관계 1"])
  })

  it("says so when the card appears in no scene", () => {
    expect(stageFacts(buildCardStage({ appearsInScenes: [], relations: [] }))).toEqual([
      "주연",
      "등장 씬 없음"
    ])
  })

  it("keeps an unknown role label verbatim", () => {
    expect(stageFacts(buildCardStage({ role: "narrator" }))[0]).toBe("narrator")
  })

  it("falls back to the target label with no stage", () => {
    expect(stageTitle(characterTarget)).toBe("인물 · seorin.card")
  })
})
