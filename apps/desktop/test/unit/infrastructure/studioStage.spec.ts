import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { readStudioStage } from "@/infrastructure/persistence/studioStage"
import type { StudioTarget } from "@/shared/messaging"

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

    const stage = await readStudioStage(workspaceRoot, { kind: "project", hasSelection: false })

    expect(stage).toBeUndefined()
  })

  it("reads the seed title and the draft facts", async () => {
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/draft/01-intro.md": draftText
    })

    const stage = await readStudioStage(workspaceRoot, sceneTarget)

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

    const stage = await readStudioStage(workspaceRoot, sceneTarget)

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

    const stage = await readStudioStage(workspaceRoot, sceneTarget)

    expect(stage?.draftRevision).toBe(3)
  })

  it("leaves the draft unversioned when no history is archived", async () => {
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/draft/01-intro.md": draftText
    })

    const stage = await readStudioStage(workspaceRoot, sceneTarget)

    expect(stage?.draftRevision).toBeUndefined()
  })

  it("reports a reviewed scene as clean or as carrying issues", async () => {
    const plan = (remainingBlocking: number): string =>
      [
        "version: 1.0.0",
        "entries:",
        "  - sceneStem: 01-intro",
        '    checkedAt: "2026-08-06T09:00:00.000Z"',
        "    revisionCount: 1",
        `    remainingBlocking: ${remainingBlocking}`,
        "    instructions: []"
      ].join("\n")

    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/.storyboard/outline/revision-plan.yaml": plan(0)
    })
    expect((await readStudioStage(workspaceRoot, sceneTarget))?.review).toBe("clean")

    vi.restoreAllMocks()
    stubWorkspace({
      "/workspace/scene/01-intro.card": sceneText,
      "/workspace/.storyboard/outline/revision-plan.yaml": plan(2)
    })
    expect((await readStudioStage(workspaceRoot, sceneTarget))?.review).toBe("issues")
  })
})
