import { stubFileSystem } from "../../../../stubs/fileSystem"
import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { StudioFollowUpRepository } from "@storyboard/story-engine"
import type { StudioFollowUp, StudioEntity } from "@storyboard/story-model"

const workspaceRoot = vscode.Uri.file("/workspace")
const followUpPath = "/workspace/.storyboard/cache/studio-followups.json"

const seorin: StudioEntity = { kind: "character", key: "seorin" }
const subway: StudioEntity = { kind: "background", key: "subway" }
const scene: StudioEntity = { kind: "scene", key: "03-subway" }

let files: Map<string, string>

function followUp(overrides: Partial<StudioFollowUp> = {}): StudioFollowUp {
  return {
    id: "f1",
    target: seorin,
    origin: subway,
    reason: "감정 서술이 어긋납니다",
    instruction: "지하철 묘사 변경에 맞춰 감정 서술을 고쳐줘",
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides
  }
}

beforeEach((): void => {
  files = new Map()

  vi.spyOn(vscode.workspace.fs, "createDirectory").mockImplementation(async () => undefined)

  vi.spyOn(vscode.workspace.fs, "writeFile").mockImplementation(async (uri, content) => {
    files.set(String((uri as { fsPath: string }).fsPath), new TextDecoder().decode(content))
  })

  vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
    const content = files.get(String((uri as { fsPath: string }).fsPath))
    if (content === undefined) {
      throw new Error("missing")
    }
    return new TextEncoder().encode(content)
  })
})

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("StudioFollowUpRepository", () => {
  it("reports nothing when no follow-up file exists", async () => {
    expect(await new StudioFollowUpRepository(stubFileSystem).list(workspaceRoot, seorin)).toEqual([])
  })

  it("stores follow-ups in the workspace cache", async () => {
    const repository = new StudioFollowUpRepository(stubFileSystem)

    await repository.add(workspaceRoot, [followUp()])

    expect(files.has(followUpPath)).toBe(true)
    expect(await repository.list(workspaceRoot, seorin)).toHaveLength(1)
  })

  it("lists only the follow-ups aimed at the given entity", async () => {
    const repository = new StudioFollowUpRepository(stubFileSystem)

    await repository.add(workspaceRoot, [
      followUp(),
      followUp({ id: "f2", target: scene, origin: subway })
    ])

    expect(await repository.list(workspaceRoot, seorin)).toHaveLength(1)
    expect((await repository.list(workspaceRoot, scene))[0]?.id).toBe("f2")
  })

  it("writes nothing for an empty batch", async () => {
    await new StudioFollowUpRepository(stubFileSystem).add(workspaceRoot, [])

    expect(files.size).toBe(0)
  })

  it("replaces an earlier follow-up from the same origin to the same target", async () => {
    const repository = new StudioFollowUpRepository(stubFileSystem)

    await repository.add(workspaceRoot, [followUp()])
    await repository.add(workspaceRoot, [followUp({ id: "f2", reason: "새 이유" })])

    const remaining = await repository.list(workspaceRoot, seorin)

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.reason).toBe("새 이유")
  })

  it("clears every follow-up aimed at an entity once it is edited", async () => {
    const repository = new StudioFollowUpRepository(stubFileSystem)

    await repository.add(workspaceRoot, [
      followUp(),
      followUp({ id: "f2", target: seorin, origin: scene }),
      followUp({ id: "f3", target: scene, origin: subway })
    ])

    await repository.resolveFor(workspaceRoot, seorin)

    expect(await repository.list(workspaceRoot, seorin)).toEqual([])
    expect(await repository.list(workspaceRoot, scene)).toHaveLength(1)
  })

  it("dismisses one follow-up by id", async () => {
    const repository = new StudioFollowUpRepository(stubFileSystem)

    await repository.add(workspaceRoot, [followUp(), followUp({ id: "f2", origin: scene })])
    await repository.dismiss(workspaceRoot, "f1")

    const remaining = await repository.list(workspaceRoot, seorin)

    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe("f2")
  })

  it("starts over when the stored file cannot be parsed", async () => {
    files.set(followUpPath, "{ not json")

    expect(await new StudioFollowUpRepository(stubFileSystem).list(workspaceRoot, seorin)).toEqual([])
  })
})
