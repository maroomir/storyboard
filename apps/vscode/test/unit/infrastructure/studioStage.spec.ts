import { cardsFromFiles } from "../../stubs/cards"
import { scenesFromFiles } from "../../stubs/scenes"
import { stubSummaries } from "../../stubs/summaries"
import type { DraftHistoryArchiver } from "@storyboard/story-engine"

let stubbedHistory: string[] = []

function historyOf(): DraftHistoryArchiver {
  return { listRevisions: async (): Promise<readonly string[]> => stubbedHistory } as unknown as DraftHistoryArchiver
}

let stubbedFiles: Record<string, string> = {}
import { stubFileSystem } from "../../stubs/fileSystem"
import { createMemoryRevisionPlans } from "../../stubs/caches"
import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StudioContextRepository } from "@storyboard/story-engine"
import type { RevisionPlan, StudioTarget } from "@storyboard/story-model"

const workspaceRoot = vscode.Uri.file("/workspace")

const sceneTarget: StudioTarget = {
  kind: "scene",
  label: "01-intro.card",
  sceneUri: "file:///workspace/scene/01-intro.card",
  hasSelection: false
}

const sceneText = ["type: scene", "id: 01-intro", "title: 첫 등교", "summary: 본문"].join("\n")
const draftText = [
  "---",
  "sceneStem: 01-intro",
  "format: novel",
  'generatedAt: "2026-08-06T09:00:00.000Z"',
  "---",
  "초안 본문"
].join("\n")

function stubWorkspace(files: Record<string, string>, historyFileNames: string[] = []): void {
  stubbedFiles = files
  stubbedHistory = historyFileNames
  vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
    const content = files[String(uri)]
    if (content === undefined) {
      throw new Error(`missing file: ${String(uri)}`)
    }
    return new TextEncoder().encode(content)
  })

  vi.spyOn(vscode.workspace.fs, "stat").mockImplementation(async (uri) => {
    if (files[String(uri)] === undefined) {
      throw new Error(`missing file: ${String(uri)}`)
    }
    return { type: 1, mtime: Date.parse("2026-08-06T09:00:00.000Z") }
  })

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async () =>
    historyFileNames.map((name): [string, number] => [name, 1])
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("readStudioStage", () => {
  it("returns nothing for a target without a scene", async () => {
    stubWorkspace({})

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, { kind: "project", hasSelection: false })

    expect(stage).toBeUndefined()
  })

  it("reads the seed title and the draft facts", async () => {
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/draft/01-intro.md": draftText
    })

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget)

    expect(stage).toEqual(
      expect.objectContaining({
        sceneStem: "01-intro",
        title: "첫 등교",
        draftLength: "초안 본문".length,
        draftUpdatedAt: "2026-08-06T09:00:00.000Z",
        review: "unreviewed"
      })
    )
  })

  it("leaves the draft facts empty when no draft exists", async () => {
    stubWorkspace({ "/workspace/scene/01-intro.card": sceneText })

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget)

    expect(stage?.draftUpdatedAt).toBeUndefined()
    expect(stage?.draftLength).toBeUndefined()
  })

  it("counts the live draft as one past the highest archived revision", async () => {
    stubWorkspace(
      {
        "/workspace/scene/01-intro.card": sceneText,
        "/workspace/draft/01-intro.md": draftText
      },
      ["2026-08-05-10-00-rev-01.md", "2026-08-06-09-00-rev-02.md"]
    )

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget)

    expect(stage?.draftRevision).toBe(3)
  })

  it("leaves the draft unversioned when no history is archived", async () => {
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/draft/01-intro.md": draftText
    })

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget)

    expect(stage?.draftRevision).toBeUndefined()
  })

  it("reports a reviewed scene as clean or as carrying issues", async () => {
    const plan = (remainingBlocking: number): RevisionPlan => ({
      version: "1.0.0",
      entries: [
        {
          sceneStem: "01-intro",
          checkedAt: "2026-08-06T09:00:00.000Z",
          revisionCount: 1,
          remainingBlocking,
          instructions: []
        }
      ]
    })
    const revisionPlans = createMemoryRevisionPlans()

    stubWorkspace({ "/workspace/scene/01-intro.card": sceneText })
    await revisionPlans.replaceLatest(workspaceRoot, plan(0))
    expect((await new StudioContextRepository(stubFileSystem, revisionPlans, cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget))?.review).toBe("clean")

    vi.restoreAllMocks()
    stubWorkspace({ "/workspace/scene/01-intro.card": sceneText })
    await revisionPlans.replaceLatest(workspaceRoot, plan(2))
    expect((await new StudioContextRepository(stubFileSystem, revisionPlans, cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, sceneTarget))?.review).toBe("issues")
  })
})

const characterCardText = [
  "type: character",
  "id: seorin",
  "name: 서린",
  "role: main",
  "relations:",
  "  - target: jiho",
  "    type: 소꿉친구"
].join("\n")

const backgroundCardText = ["type: location", "id: subway", "name: 지하철"].join("\n")

function stubCardWorkspace(files: Record<string, string>, sceneFileNames: string[]): void {
  stubbedFiles = files
  vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
    const content = files[String(uri)]
    if (content === undefined) {
      throw new Error(`missing file: ${String(uri)}`)
    }
    return new TextEncoder().encode(content)
  })

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async () =>
    sceneFileNames.map((name): [string, number] => [name, 1])
  )
}

describe("readStudioStage for card entities", () => {
  it("summarizes a character card with its relations and scene appearances", async () => {
    stubCardWorkspace(
      {
        "/workspace/character/seorin.card": characterCardText,
        "/workspace/scene/01-intro.card": [
          "type: scene",
          "id: 01-intro",
          "characters: [seorin]",
          "summary: 본문"
        ].join("\n"),
        "/workspace/scene/02-departure.card": [
          "type: scene",
          "id: 02-departure",
          "characters: [jiho]",
          "summary: 본문"
        ].join("\n")
      },
      ["01-intro.card", "02-departure.card", ".sample.card"]
    )

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, {
      kind: "character",
      entity: { kind: "character", key: "seorin" },
      hasSelection: false
    })

    expect(stage).toEqual({
      kind: "card",
      cardKind: "character",
      cardId: "seorin",
      name: "서린",
      role: "main",
      relations: [{ target: "jiho", type: "소꿉친구" }],
      appearsInScenes: ["01-intro"]
    })
  })

  it("detects an undeclared character through the scene body", async () => {
    stubCardWorkspace(
      {
        "/workspace/character/seorin.card": characterCardText,
        "/workspace/scene/01-intro.card": [
          "type: scene",
          "id: 01-intro",
          "summary: 서린이 교문 앞에 서 있었다."
        ].join("\n")
      },
      ["01-intro.card"]
    )

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, {
      kind: "character",
      entity: { kind: "character", key: "seorin" },
      hasSelection: false
    })

    expect(stage?.kind === "card" ? stage.appearsInScenes : []).toEqual(["01-intro"])
  })

  it("summarizes a background card with no relations", async () => {
    stubCardWorkspace(
      {
        "/workspace/background/subway.card": backgroundCardText,
        "/workspace/scene/01-intro.card": [
          "type: scene",
          "id: 01-intro",
          "location: subway",
          "summary: 본문"
        ].join("\n")
      },
      ["01-intro.card"]
    )

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, {
      kind: "background",
      entity: { kind: "background", key: "subway" },
      hasSelection: false
    })

    expect(stage).toEqual({
      kind: "card",
      cardKind: "background",
      cardId: "subway",
      name: "지하철",
      relations: [],
      appearsInScenes: ["01-intro"]
    })
  })

  it("returns nothing when the card file is missing", async () => {
    stubCardWorkspace({}, [])

    const stage = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readStage(workspaceRoot, {
      kind: "character",
      entity: { kind: "character", key: "ghost" },
      hasSelection: false
    })

    expect(stage).toBeUndefined()
  })
})

describe("studio scene card context", () => {
  it("lists the work's characters and places by id, so a scene made from a description can name its cast", async () => {
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/character/ri-na.card": ["type: character", "id: ri-na", "name: 리나", "role: main", "aliases:", "  - 견습생"].join("\n"),
      "/workspace/background/astel-tower.card": ["type: location", "id: astel-tower", "name: 아스텔 마탑"].join("\n")
    })

    const context = await new StudioContextRepository(stubFileSystem, createMemoryRevisionPlans(), cardsFromFiles(() => stubbedFiles), scenesFromFiles(() => stubbedFiles), stubSummaries(), historyOf()).readEntityContext(workspaceRoot, { kind: "scene", key: "01-intro" }, "card")

    expect(context?.context).toContain("- 인물 ri-na: 리나 (별칭: 견습생)")
    expect(context?.context).toContain("- 배경 astel-tower: 아스텔 마탑")
  })
})
