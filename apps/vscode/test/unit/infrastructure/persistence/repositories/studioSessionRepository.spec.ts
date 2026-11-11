import { createMemoryCaches } from "../../../../stubs/caches"
import * as vscode from "vscode"
import { beforeEach, describe, expect, it } from "vitest"

import {
  SessionStore,
  StudioSessionRepository,
  type WorkspaceCaches,
  type WorkspaceCards,
  type WorkspaceScenes
} from "@storyboard/story-engine"
import type { StudioChatTurn, StudioEntity } from "@storyboard/story-model"

const workspaceRoot = vscode.Uri.file("/workspace")

const characterEntity: StudioEntity = { kind: "character", key: "seorin" }
const sceneEntity: StudioEntity = { kind: "scene", key: "001-intro" }

const turns: StudioChatTurn[] = [{ id: "u1", role: "user", text: "과거사 보강해줘" }]

const cardIds: Map<string, string> = new Map([
  ["character:seorin", "card-uuid-1"],
  ["character:seo-rin", "card-uuid-1"]
])

const cards = {
  loadRoster: async (): Promise<unknown> => ({ lookup: { idOf: (kind: string, slug: string) => cardIds.get(`${kind}:${slug}`) } })
} as unknown as WorkspaceCards

const scenes = {
  find: async (_root: unknown, key: string) =>
    key === "001-intro" ? { content: { header: { id: "scene-uuid-1" } } } : undefined
} as unknown as WorkspaceScenes

let caches: WorkspaceCaches

function createRepository(): StudioSessionRepository {
  return new StudioSessionRepository({ caches, cards, scenes })
}

function pendingProposal(): StudioChatTurn {
  return {
    id: "p1",
    role: "assistant",
    kind: "proposal",
    summary: "역할 변경",
    targetFile: "character/seorin.card",
    patch: { target: "card", changes: [{ field: "role", value: "supporting" }] },
    baselineHash: "sha256:x",
    validation: { state: "pass", warnings: [] },
    status: "pending"
  } as StudioChatTurn
}

async function saveSession(
  repository: StudioSessionRepository,
  id: string,
  entity: StudioEntity = characterEntity,
  sessionTurns: StudioChatTurn[] = turns
): Promise<void> {
  await repository.save(workspaceRoot, {
    id,
    entity,
    createdAt: "2026-08-01T00:00:00.000Z",
    hasAppliedChanges: false,
    turns: sessionTurns
  })
}

beforeEach((): void => {
  caches = createMemoryCaches()
})

describe("StudioSessionRepository", () => {
  it("keeps each entity's sessions apart", async () => {
    const repository = createRepository()

    await saveSession(repository, "s1")
    await saveSession(repository, "s2", sceneEntity)

    expect(await repository.list(workspaceRoot, characterEntity)).toHaveLength(1)
    expect((await repository.list(workspaceRoot, sceneEntity))[0]?.id).toBe("s2")
  })

  it("finds a card's sessions after the card is renamed", async () => {
    const repository = createRepository()

    await saveSession(repository, "s1")

    expect(
      (await repository.list(workspaceRoot, { kind: "character", key: "seo-rin" })).map((session) => session.id)
    ).toEqual(["s1"])
  })

  it("stores nothing for an entity that is no card or scene", async () => {
    const repository = createRepository()

    await saveSession(repository, "s1", { kind: "character", key: "nobody" })

    expect(await repository.list(workspaceRoot, { kind: "character", key: "nobody" })).toEqual([])
  })

  it("loads the newest session for an entity", async () => {
    const repository = createRepository()

    await saveSession(repository, "old")
    await new Promise((resolve) => setTimeout(resolve, 2))
    await saveSession(repository, "new", characterEntity, [{ id: "u2", role: "user", text: "말투 다듬어줘" }])

    expect((await repository.loadLatest(workspaceRoot, characterEntity))?.id).toBe("new")
  })

  it("reports nothing for an entity with no sessions", async () => {
    const repository = createRepository()

    expect(await repository.loadLatest(workspaceRoot, sceneEntity)).toBeUndefined()
    expect(await repository.list(workspaceRoot, sceneEntity)).toEqual([])
  })

  it("keeps every session until the cache is cleared", async () => {
    const repository = createRepository()

    for (let index = 0; index < 12; index += 1) {
      await saveSession(repository, `s${index}`)
    }

    expect(await repository.list(workspaceRoot, characterEntity)).toHaveLength(12)
  })

  it("counts the proposals still waiting in a session", async () => {
    const repository = createRepository()

    await saveSession(repository, "s1", characterEntity, [...turns, pendingProposal()])

    const pending = new SessionStore(await caches.open(workspaceRoot)).listWithPending()
    expect(pending.map((record) => [record.id, record.pendingCount])).toEqual([["s1", 1]])
  })
})
