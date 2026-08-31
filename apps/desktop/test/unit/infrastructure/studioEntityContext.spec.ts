import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  readStudioEntityContext,
  resolveStudioFollowUps,
  resolveStudioLookups
} from "@/infrastructure/persistence/studioEntityContext"

const workspaceRoot = vscode.Uri.file("/workspace")

let readPaths: string[]

beforeEach((): void => {
  readPaths = []

  vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
    readPaths.push(String((uri as { fsPath: string }).fsPath))
    throw new Error("missing")
  })

  vi.spyOn(vscode.workspace.fs, "stat").mockImplementation(async (uri) => {
    readPaths.push(String((uri as { fsPath: string }).fsPath))
    return { type: 1 as never }
  })

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async () => [])
})

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("studio entity path safety", () => {
  it("refuses an entity key that could escape the workspace", async () => {
    const context = await readStudioEntityContext(workspaceRoot, {
      kind: "character",
      key: "../../escape"
    })

    expect(context).toBeUndefined()
    expect(readPaths).toEqual([])
  })

  it("refuses a scene key with a path separator", async () => {
    expect(
      await readStudioEntityContext(workspaceRoot, { kind: "scene", key: "a/b" })
    ).toBeUndefined()
    expect(readPaths).toEqual([])
  })

  it("drops a lookup whose key is not a card id", async () => {
    const text = await resolveStudioLookups(workspaceRoot, [
      { kind: "draft", key: "../../outside/notes" },
      { kind: "character", key: "jiho" }
    ])

    expect(text).toContain("character/jiho")
    expect(text).not.toContain("outside")
    expect(readPaths.some((path) => path.includes(".."))).toBe(false)
  })

  it("drops a follow-up whose key is not a card id", async () => {
    const followUps = await resolveStudioFollowUps(workspaceRoot, [
      { kind: "scene", key: "../../x", reason: "r", instruction: "i" },
      { kind: "character", key: "jiho", reason: "r", instruction: "i" }
    ])

    expect(followUps.map((followUp) => followUp.targetFile)).toEqual(["character/jiho.card"])
  })
})
