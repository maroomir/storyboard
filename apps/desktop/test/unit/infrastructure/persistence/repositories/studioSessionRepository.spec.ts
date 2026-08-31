import { stubFileSystem as engineFileSystem } from "../../../../stubs/fileSystem"
import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { StudioSessionRepository } from "@storyboard/story-engine"
import type { StudioChatTurn, StudioEntity } from "@storyboard/story-engine"

const workspaceRoot = vscode.Uri.file("/workspace")
const sessionRoot = "/workspace/.storyboard/cache/studio-sessions"

const characterEntity: StudioEntity = { kind: "character", key: "seorin" }
const sceneEntity: StudioEntity = { kind: "scene", key: "01-intro" }

const turns: StudioChatTurn[] = [{ id: "u1", role: "user", text: "과거사 보강해줘" }]

let files: Map<string, string>

function stubFileSystem(): void {
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

  vi.spyOn(vscode.workspace.fs, "delete").mockImplementation(async (uri) => {
    files.delete(String((uri as { fsPath: string }).fsPath))
  })

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async (uri) => {
    const prefix = `${String((uri as { fsPath: string }).fsPath)}/`

    return [...files.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path): [string, number] => [path.slice(prefix.length), 1])
  })
}

beforeEach((): void => {
  stubFileSystem()
})

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("StudioSessionRepository", () => {
  it("stores a session under its entity directory", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "s1",
      entity: characterEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })

    expect([...files.keys()]).toEqual([`${sessionRoot}/character/seorin/s1.json`])
  })

  it("keeps each entity's sessions apart", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "s1",
      entity: characterEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })
    await repository.save(workspaceRoot, {
      id: "s2",
      entity: sceneEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })

    expect(await repository.list(workspaceRoot, characterEntity)).toHaveLength(1)
    expect((await repository.list(workspaceRoot, sceneEntity))[0]?.id).toBe("s2")
  })

  it("refuses an entity key that could escape the sessions directory", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "s1",
      entity: { kind: "character", key: "../../escape" },
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })

    expect(files.size).toBe(0)
  })

  it("refuses a session id that could escape the entity directory", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "../escape",
      entity: characterEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })

    expect(files.size).toBe(0)
  })

  it("loads the newest session for an entity", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "old",
      entity: characterEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: false,
      turns
    })
    await new Promise((resolve) => setTimeout(resolve, 2))
    await repository.save(workspaceRoot, {
      id: "new",
      entity: characterEntity,
      createdAt: "2026-08-02T00:00:00.000Z",
      hasAppliedChanges: false,
      turns: [{ id: "u2", role: "user", text: "말투 다듬어줘" }]
    })

    expect((await repository.loadLatest(workspaceRoot, characterEntity))?.id).toBe("new")
  })

  it("reports nothing for an entity with no sessions", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    expect(await repository.loadLatest(workspaceRoot, sceneEntity)).toBeUndefined()
    expect(await repository.list(workspaceRoot, sceneEntity)).toEqual([])
  })

  it("prunes the oldest unapplied sessions past the keep budget", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    for (let index = 0; index < 12; index += 1) {
      await repository.save(workspaceRoot, {
        id: `s${index}`,
        entity: characterEntity,
        createdAt: "2026-08-01T00:00:00.000Z",
        hasAppliedChanges: false,
        turns
      })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }

    const remaining = await repository.list(workspaceRoot, characterEntity)

    expect(remaining).toHaveLength(10)
    expect(remaining.map((session) => session.id)).not.toContain("s0")
  })

  it("never prunes a session whose proposal was applied", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)

    await repository.save(workspaceRoot, {
      id: "applied",
      entity: characterEntity,
      createdAt: "2026-08-01T00:00:00.000Z",
      hasAppliedChanges: true,
      turns
    })

    for (let index = 0; index < 12; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      await repository.save(workspaceRoot, {
        id: `s${index}`,
        entity: characterEntity,
        createdAt: "2026-08-01T00:00:00.000Z",
        hasAppliedChanges: false,
        turns
      })
    }

    const remaining = await repository.list(workspaceRoot, characterEntity)

    expect(remaining.map((session) => session.id)).toContain("applied")
    expect(remaining).toHaveLength(11)
  })

  it("skips a session file that does not parse", async () => {
    const repository = new StudioSessionRepository(engineFileSystem)
    files.set(`${sessionRoot}/character/seorin/broken.json`, "{ not json")

    expect(await repository.list(workspaceRoot, characterEntity)).toEqual([])
  })
})
