import { createMemoryCaches } from "../../../stubs/caches"
import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  SessionStore,
  StudioCreateUseCase,
  StudioEditUseCase,
  StudioSessionRepository,
  type CreateCardUseCase,
  type CreateSceneUseCase,
  type StudioChatUseCase,
  type StudioContextRepository,
  type StudioEditResult,
  type StudioProposalApplier,
  type WorkspaceCaches,
  type WorkspaceCards,
  type WorkspaceScenes
} from "@storyboard/story-engine"
import type { StudioChatTurn, StudioEntity, StudioSessionSnapshot } from "@storyboard/story-model"

const workspaceRoot = vscode.Uri.file("/workspace")
const entity: StudioEntity = { kind: "character", key: "seorin" }

const proposal: StudioChatTurn = {
  id: "p1",
  role: "assistant",
  kind: "proposal",
  summary: "말투를 퉁명스럽게",
  targetFile: "character/seorin.card",
  patch: { target: "card", changes: [{ field: "voice", value: "짧게 끊어 말한다" }] },
  baselineHash: "sha256:x",
  validation: { state: "pass", warnings: [] },
  status: "pending"
} as StudioChatTurn

const cards = {
  loadRoster: async (): Promise<unknown> => ({ lookup: { idOf: (_kind: string, slug: string) => (slug === "seorin" ? "card-uuid" : undefined) } })
} as unknown as WorkspaceCards
const scenes = { find: async () => undefined } as unknown as WorkspaceScenes

let caches: WorkspaceCaches
let sessions: StudioSessionRepository
let replies: readonly StudioChatTurn[]
const applier = {
  prepare: vi.fn(async () => ({ ok: true, targetFile: "character/seorin.card", baseline: "voice: 길게\n", text: "voice: 짧게\n" })),
  apply: vi.fn(async () => ({ status: "applied", message: "character/seorin.card 적용됨 · voice" }))
}

function createEdit(): StudioEditUseCase {
  return new StudioEditUseCase({
    chat: { execute: async () => replies } as unknown as StudioChatUseCase,
    context: {
      readEntityContext: async (_root: unknown, target: StudioEntity) => (target.key === "seorin" ? { context: "", baseline: "" } : undefined),
      resolveLookups: async () => "",
      resolveFollowUps: async () => []
    } as unknown as StudioContextRepository,
    sessions,
    applier: applier as unknown as StudioProposalApplier
  })
}

async function edit(shouldPropose: boolean, target: StudioEntity = entity): Promise<StudioEditResult> {
  return await createEdit().execute({
    workspaceRoot,
    entity: target,
    instruction: "말투를 더 퉁명스럽게",
    shouldPropose,
    isValidationEnabled: false
  })
}

async function latestSession(): Promise<StudioSessionSnapshot | undefined> {
  return await sessions.loadLatest(workspaceRoot, entity)
}

beforeEach((): void => {
  caches = createMemoryCaches()
  sessions = new StudioSessionRepository({ caches, cards, scenes })
  replies = [proposal]
  applier.prepare.mockClear()
  applier.apply.mockClear()
})

describe("StudioEditUseCase", () => {
  it("applies the proposal at once and records an applied session", async () => {
    const result = await edit(false)

    expect(result).toMatchObject({ ok: true, kind: "applied", summary: "말투를 퉁명스럽게" })
    expect(applier.apply).toHaveBeenCalledOnce()
    const session = await latestSession()
    expect(session?.hasAppliedChanges).toBe(true)
    expect(session?.turns.map((turn) => (turn.role === "user" ? "user" : turn.kind))).toEqual(["user", "proposal"])
    expect(session?.turns[1]).toMatchObject({ status: "applied" })
  })

  it("keeps the proposal pending with its diff when asked to propose", async () => {
    const result = await edit(true)

    expect(result).toMatchObject({
      ok: true,
      kind: "proposed",
      diff: { targetFile: "character/seorin.card", before: "voice: 길게\n", after: "voice: 짧게\n" }
    })
    expect(applier.apply).not.toHaveBeenCalled()
    const pending = new SessionStore(await caches.open(workspaceRoot)).listWithPending()
    expect(pending).toHaveLength(1)
  })

  it("shows a preview's proposal and diff without keeping a session", async () => {
    const result = await createEdit().execute({
      workspaceRoot,
      entity,
      instruction: "말투를 더 퉁명스럽게",
      shouldPropose: true,
      isValidationEnabled: false,
      isPreview: true
    })

    expect(result).toMatchObject({ ok: true, kind: "proposed" })
    expect(new SessionStore(await caches.open(workspaceRoot)).listWithPending()).toHaveLength(0)
    expect(await latestSession()).toBeUndefined()
  })

  it("records a failed proposal without claiming it was applied", async () => {
    applier.apply.mockResolvedValueOnce({ status: "failed", message: "제안을 만든 뒤 파일이 바뀌어서" })

    expect(await edit(false)).toMatchObject({ ok: false, kind: "failed" })
    const session = await latestSession()
    expect(session?.hasAppliedChanges).toBe(false)
    expect(session?.turns[1]).toMatchObject({ status: "failed", errorMessage: "제안을 만든 뒤 파일이 바뀌어서" })
  })

  it("returns the studio's answer when it only replies", async () => {
    replies = [{ id: "a1", role: "assistant", kind: "ask", question: "어떤 상대에게요?", options: [] }]

    expect(await edit(false)).toMatchObject({ ok: true, kind: "replied", message: "어떤 상대에게요?" })
  })

  it("refuses an entity it cannot read", async () => {
    expect(await edit(false, { kind: "character", key: "nobody" })).toMatchObject({ ok: false, kind: "missing" })
  })
})

function seedAi(seed: unknown): { readonly ai: never; readonly logger: never } {
  return {
    ai: {
      gateway: {
        createService: () => ({ extractStudioCardSeed: async () => seed }),
        getTaskProvider: () => "mock"
      }
    } as never,
    logger: { warn: () => undefined } as never
  }
}

describe("StudioCreateUseCase", () => {
  it("creates the card and fills it from the description", async () => {
    const editCalls: unknown[] = []
    const create = new StudioCreateUseCase({
      createCard: {
        execute: async () => ({ ok: true, kind: "created", id: "seorin", uri: vscode.Uri.file("/workspace/character/seorin.card") })
      } as unknown as CreateCardUseCase,
      createScene: {} as unknown as CreateSceneUseCase,
      cards: {} as unknown as WorkspaceCards,
      ...seedAi(undefined),
      edit: {
        execute: async (request: unknown) => {
          editCalls.push(request)
          return { ok: true, kind: "applied", sessionId: "s", summary: "", message: "" }
        }
      } as unknown as StudioEditUseCase
    })

    const result = await create.execute({
      workspaceRoot,
      kind: "character",
      slug: "seorin",
      name: "서린",
      description: "무뚝뚝한 열일곱 살 궁수",
      shouldPropose: false,
      isValidationEnabled: false
    })

    expect(result).toMatchObject({ ok: true, kind: "created", key: "seorin" })
    expect(editCalls[0]).toMatchObject({ entity: { kind: "character", key: "seorin" } })
    expect(String((editCalls[0] as { instruction: string }).instruction)).toContain("무뚝뚝한 열일곱 살 궁수")
  })

  it("refuses a slug that is taken", async () => {
    const create = new StudioCreateUseCase({
      createCard: { execute: async () => ({ ok: false, kind: "id-taken", id: "seorin" }) } as unknown as CreateCardUseCase,
      createScene: {} as unknown as CreateSceneUseCase,
      cards: {} as unknown as WorkspaceCards,
      ...seedAi(undefined),
      edit: {} as unknown as StudioEditUseCase
    })

    expect(
      await create.execute({
        workspaceRoot,
        kind: "background",
        slug: "seorin",
        name: "서린",
        description: "-",
        shouldPropose: false,
        isValidationEnabled: false
      })
    ).toMatchObject({ ok: false, kind: "exists" })
  })

  it("names a card from its description when no name or slug is given", async () => {
    const createRequests: unknown[] = []
    const builtNames: string[] = []
    const create = new StudioCreateUseCase({
      createCard: {
        execute: async (request: { id: string; buildCard: (id: string) => { name: string } }) => {
          createRequests.push(request)
          builtNames.push(request.buildCard(request.id).name)
          return { ok: true, kind: "created", id: "rina", uri: vscode.Uri.file("/workspace/character/rina.card") }
        }
      } as unknown as CreateCardUseCase,
      createScene: {} as unknown as CreateSceneUseCase,
      cards: {} as unknown as WorkspaceCards,
      ...seedAi({ kind: "character", name: "리나", id: "rina" }),
      edit: {
        execute: async () => ({ ok: true, kind: "applied", sessionId: "s", summary: "", message: "" })
      } as unknown as StudioEditUseCase
    })

    await create.execute({
      workspaceRoot,
      kind: "character",
      description: "열일곱 살 견습 마법사 리나",
      shouldPropose: false,
      isValidationEnabled: false
    })

    expect(createRequests[0]).toMatchObject({ id: "rina", whenIdIsTaken: "number-it" })
    expect(builtNames).toEqual(["리나"])
  })

  it("gives a card made from a description alone a provisional name and a numbered slug", async () => {
    const createRequests: unknown[] = []
    const builtNames: string[] = []
    const create = new StudioCreateUseCase({
      createCard: {
        execute: async (request: { id: string; buildCard: (id: string) => { name: string } }) => {
          createRequests.push(request)
          builtNames.push(request.buildCard(request.id).name)
          return { ok: true, kind: "created", id: "new-character-2", uri: vscode.Uri.file("/workspace/character/new-character-2.card") }
        }
      } as unknown as CreateCardUseCase,
      createScene: {} as unknown as CreateSceneUseCase,
      cards: {} as unknown as WorkspaceCards,
      ...seedAi(undefined),
      edit: {
        execute: async () => ({ ok: true, kind: "applied", sessionId: "s", summary: "", message: "" })
      } as unknown as StudioEditUseCase
    })

    const result = await create.execute({
      workspaceRoot,
      kind: "character",
      description: "무뚝뚝한 열일곱 살 궁수",
      shouldPropose: false,
      isValidationEnabled: false
    })

    expect(result).toMatchObject({ ok: true, key: "new-character-2" })
    expect(createRequests[0]).toMatchObject({ id: "new-character", whenIdIsTaken: "number-it" })
    expect(builtNames).toEqual(["새 인물"])
  })
})
