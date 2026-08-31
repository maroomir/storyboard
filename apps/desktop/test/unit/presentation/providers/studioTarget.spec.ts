import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { computeStudioTarget } from "@/presentation/providers/studioTarget"
import { Uri, type WorkspaceFolder } from "../../../stubs/vscode"

const workspaceFolder: WorkspaceFolder = {
  uri: Uri.file("/workspace/story") as never,
  name: "story",
  index: 0
}

const draftBody = ["---", "sceneStem: 01-intro", "format: novel", "---", "본문"].join("\n")

function editorAt(filePath: string, options: { text?: string; hasSelection?: boolean } = {}): never {
  return {
    document: {
      uri: Uri.file(filePath),
      getText: () => options.text ?? ""
    },
    selection: { isEmpty: options.hasSelection !== true }
  } as never
}

function stubExistingFiles(existingPaths: readonly string[]): void {
  vi.spyOn(vscode.workspace.fs, "stat").mockImplementation(async (uri) => {
    if (!existingPaths.includes(String((uri as { fsPath: string }).fsPath))) {
      throw new Error(`missing: ${String((uri as { fsPath: string }).fsPath)}`)
    }

    return { type: 1 as never }
  })
}

beforeEach((): void => {
  vscode.workspace.getWorkspaceFolder = (): WorkspaceFolder => workspaceFolder
  stubExistingFiles(["/workspace/story/.storyboard/project.json"])
})

afterEach((): void => {
  vi.restoreAllMocks()
  vscode.workspace.getWorkspaceFolder = (): undefined => undefined
})

describe("computeStudioTarget", () => {
  it("reports no target outside a storyboard project", async () => {
    stubExistingFiles([])

    const target = await computeStudioTarget(editorAt("/workspace/story/character/seorin.card"))

    expect(target).toEqual({ kind: "none", hasSelection: false })
  })

  it("keys a character card target by its card id", async () => {
    const target = await computeStudioTarget(editorAt("/workspace/story/character/seorin.card"))

    expect(target.kind).toBe("character")
    expect(target.entity).toEqual({ kind: "character", key: "seorin" })
    expect(target.cardUri).toBe(Uri.file("/workspace/story/character/seorin.card").toString())
  })

  it("keys a background card target by its card id", async () => {
    const target = await computeStudioTarget(editorAt("/workspace/story/background/subway.card"))

    expect(target.kind).toBe("background")
    expect(target.entity).toEqual({ kind: "background", key: "subway" })
  })

  it("falls back to the project when the card file is the ignored sample", async () => {
    const target = await computeStudioTarget(editorAt("/workspace/story/character/.sample.card"))

    expect(target.kind).toBe("project")
    expect(target.entity).toEqual({ kind: "project", key: "story" })
  })

  it("does not treat nested card files as card targets", async () => {
    const target = await computeStudioTarget(
      editorAt("/workspace/story/character/profile/seorin.card")
    )

    expect(target.kind).toBe("project")
  })

  it("keys a scene card target by its stem and reports draft existence", async () => {
    stubExistingFiles([
      "/workspace/story/.storyboard/project.json",
      "/workspace/story/draft/01-intro.md"
    ])

    const target = await computeStudioTarget(editorAt("/workspace/story/scene/01-intro.card"))

    expect(target.kind).toBe("scene")
    expect(target.entity).toEqual({ kind: "scene", key: "01-intro" })
    expect(target.draftExists).toBe(true)
  })

  it("keys a draft target by the same scene entity as its scene card", async () => {
    const target = await computeStudioTarget(
      editorAt("/workspace/story/draft/01-intro.md", { text: draftBody })
    )

    expect(target.kind).toBe("draft")
    expect(target.entity).toEqual({ kind: "scene", key: "01-intro" })
  })

  it("keys a draft entity from its file name even without a scene link in the body", async () => {
    const target = await computeStudioTarget(
      editorAt("/workspace/story/draft/02-departure.md", { text: "본문만 있는 초안" })
    )

    expect(target.entity).toEqual({ kind: "scene", key: "02-departure" })
    expect(target.sceneUri).toBeUndefined()
  })

  it("leaves a draft outside the scene naming convention without an entity", async () => {
    const target = await computeStudioTarget(
      editorAt("/workspace/story/draft/notes.md", { text: "메모" })
    )

    expect(target.kind).toBe("draft")
    expect(target.entity).toBeUndefined()
  })

  it("carries the selection flag onto the target", async () => {
    const target = await computeStudioTarget(
      editorAt("/workspace/story/draft/01-intro.md", { text: draftBody, hasSelection: true })
    )

    expect(target.hasSelection).toBe(true)
  })
})
