import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { hashBaseline } from "@storyboard/story-engine"
import { createWebviewBridge, type StoryboardWebviewLike } from "@/presentation/messaging/bridge"
import { createStudioProposalRpcHandlers } from "@/presentation/messaging/studioProposalRpcHandlers"
import type { ProposalReviewService } from "@/presentation/providers/proposalReviewService"
import { storyboardMessageProtocolVersion } from "@storyboard/story-engine"
import type { StudioChatTurn, StudioEntity } from "@storyboard/story-engine"

const workspaceRoot = vscode.Uri.file("/workspace")
const characterEntity: StudioEntity = { kind: "character", key: "seorin" }
const sceneEntity: StudioEntity = { kind: "scene", key: "01-intro" }

const cardText = ["type: character", "id: seorin", "name: 서린", "role: main"].join("\n")
const sceneText = ["type: scene", "id: 01-intro", "summary: 시드"].join("\n")
const draftText = [
  "---",
  "sceneStem: 01-intro",
  "format: novel",
  'generatedAt: "2026-08-06T09:00:00.000Z"',
  "---",
  "0123456789"
].join("\n")

let files: Map<string, string>
const shownDiffs: unknown[] = []

const reviewService = {
  showDiffs: async (items: unknown): Promise<void> => {
    shownDiffs.push(items)
  }
} as unknown as ProposalReviewService

class FakeWebview implements StoryboardWebviewLike {
  public readonly postedMessages: unknown[] = []
  private listener: ((message: unknown) => void | PromiseLike<void>) | undefined

  public async postMessage(message: unknown): Promise<boolean> {
    this.postedMessages.push(message)
    return true
  }

  public onDidReceiveMessage(
    listener: (message: unknown) => void | PromiseLike<void>
  ): { readonly dispose: () => void } {
    this.listener = listener
    return { dispose: (): void => undefined }
  }

  public async receive(message: unknown): Promise<void> {
    await this.listener?.(message)
  }
}

function proposalTurn(overrides: Partial<Record<string, unknown>> = {}): StudioChatTurn {
  return {
    id: "p1",
    role: "assistant",
    kind: "proposal",
    summary: "역할 변경",
    targetFile: "character/seorin.card",
    patch: { target: "card", changes: [{ field: "role", value: "supporting" }] },
    baselineHash: hashBaseline(cardText),
    validation: { state: "pass", warnings: [] },
    status: "pending",
    ...overrides
  } as StudioChatTurn
}

const followUpCalls: {
  added: unknown[][]
  resolvedFor: unknown[]
  dismissed: string[]
} = { added: [], resolvedFor: [], dismissed: [] }

const archivedDrafts: string[] = []

const configBridge = { isKeepDraftHistoryEnabled: (): boolean => keepDraftHistory }
const harnessLogger = { warn: (): void => undefined }

let keepDraftHistory = false

const followUpRepository = {
  list: async (): Promise<never[]> => [],
  add: async (_root: unknown, added: unknown[]): Promise<void> => {
    followUpCalls.added.push(added)
  },
  resolveFor: async (_root: unknown, target: unknown): Promise<void> => {
    followUpCalls.resolvedFor.push(target)
  },
  dismiss: async (_root: unknown, id: string): Promise<void> => {
    followUpCalls.dismissed.push(id)
  }
}

function bridgeWith(): FakeWebview {
  const webview = new FakeWebview()
  createWebviewBridge(
    webview,
    createStudioProposalRpcHandlers({
      reviewService,
      followUpRepository,
      configBridge,
      logger: harnessLogger,
      getProjectRoot: async () => workspaceRoot,
      createFollowUpId: () => "follow-1"
    })
  )
  return webview
}

async function send(
  webview: FakeWebview,
  method: string,
  payload: unknown
): Promise<{ ok: boolean; payload?: Record<string, unknown> }> {
  await webview.receive({
    protocolVersion: storyboardMessageProtocolVersion,
    type: "request",
    id: `${method}-1`,
    method,
    payload
  })

  return webview.postedMessages.at(-1) as { ok: boolean; payload?: Record<string, unknown> }
}

beforeEach((): void => {
  keepDraftHistory = false
  archivedDrafts.length = 0
  shownDiffs.length = 0
  followUpCalls.added.length = 0
  followUpCalls.resolvedFor.length = 0
  followUpCalls.dismissed.length = 0
  files = new Map([
    ["/workspace/character/seorin.card", cardText],
    ["/workspace/scene/01-intro.card", sceneText],
    ["/workspace/draft/01-intro.md", draftText]
  ])

  vi.spyOn(vscode.workspace.fs, "readFile").mockImplementation(async (uri) => {
    const content = files.get(String((uri as { fsPath: string }).fsPath))
    if (content === undefined) {
      throw new Error("missing")
    }
    return new TextEncoder().encode(content)
  })

  vi.spyOn(vscode.workspace.fs, "writeFile").mockImplementation(async (uri, content) => {
    files.set(String((uri as { fsPath: string }).fsPath), new TextDecoder().decode(content))
  })

  vi.spyOn(vscode.workspace.fs, "stat").mockImplementation(async (uri) => {
    if (!files.has(String((uri as { fsPath: string }).fsPath))) {
      throw new Error("missing")
    }
    return { type: 1, mtime: 0 } as never
  })

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async () => [])
  vi.spyOn(vscode.workspace.fs, "createDirectory").mockImplementation(async () => undefined)
})

afterEach((): void => {
  vi.restoreAllMocks()
})

describe("studio proposal rpc handlers", () => {
  it("writes the patched card on apply", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(response.payload?.status).toBe("applied")
    expect(files.get("/workspace/character/seorin.card")).toContain("role: supporting")
  })

  it("reports which fields changed and by how much", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(String(response.payload?.message)).toContain("character/seorin.card 적용됨")
    expect(String(response.payload?.message)).toContain("role")
  })

  it("refuses to apply when the file changed after the proposal", async () => {
    files.set("/workspace/character/seorin.card", `${cardText}\ntags:\n  - 추가됨`)

    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("파일이 바뀌어서")
    expect(files.get("/workspace/character/seorin.card")).toContain("추가됨")
  })

  it("keeps the draft frontmatter when patching the body", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: proposalTurn({
        targetFile: "draft/01-intro.md",
        patch: { target: "draft", replacements: [{ startOffset: 0, endOffset: 2, oldText: "01", newText: "XY" }] },
        baselineHash: hashBaseline(draftText)
      })
    })

    expect(response.payload?.status).toBe("applied")

    const written = files.get("/workspace/draft/01-intro.md") ?? ""
    expect(written).toContain("sceneStem: 01-intro")
    expect(written).toContain("XY23456789")
  })

  it("fails when the target file is missing", async () => {
    files.delete("/workspace/character/seorin.card")

    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("찾을 수 없습니다")
  })

  it("refuses a turn that is not a proposal", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: { id: "u1", role: "user", text: "보강해줘" }
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("적용할 제안이 아닙니다")
  })

  it("opens a diff on preview without writing", async () => {
    const response = await send(bridgeWith(), "studio.proposal.preview", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(response.ok).toBe(true)
    expect(shownDiffs).toHaveLength(1)
    expect(files.get("/workspace/character/seorin.card")).toBe(cardText)
  })

  it("shows no diff when the proposal cannot be prepared", async () => {
    files.set("/workspace/character/seorin.card", `${cardText}\ntags:\n  - 추가됨`)

    await send(bridgeWith(), "studio.proposal.preview", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(shownDiffs).toHaveLength(0)
  })
})

describe("studio proposal rpc handlers for scene cards", () => {
  const sceneCardTurn = (overrides: Partial<Record<string, unknown>> = {}): StudioChatTurn =>
    proposalTurn({
      summary: "갈등 정리",
      targetFile: "scene/01-intro.card",
      patch: { target: "card", changes: [{ field: "purpose", value: "인물 소개와 갈등 암시" }] },
      baselineHash: hashBaseline(sceneText),
      ...overrides
    })

  it("writes the patched scene card and leaves the draft alone", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: sceneCardTurn()
    })

    expect(response.payload?.status).toBe("applied")
    expect(files.get("/workspace/scene/01-intro.card")).toContain("purpose: 인물 소개와 갈등 암시")
    expect(files.get("/workspace/draft/01-intro.md")).toBe(draftText)
  })

  it("fills the cast and location with ids that resolve to real cards", async () => {
    files.set("/workspace/background/subway.card", "type: location\nid: subway\nname: 지하철")

    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: sceneCardTurn({
        patch: {
          target: "card",
          changes: [
            { field: "characters", value: ["seorin"] },
            { field: "location", value: "subway" }
          ]
        }
      })
    })

    expect(response.payload?.status).toBe("applied")
    expect(files.get("/workspace/scene/01-intro.card")).toContain("location: subway")
  })

  it("refuses a cast id with no card behind it", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: sceneCardTurn({
        patch: { target: "card", changes: [{ field: "characters", value: ["seorin", "ghost"] }] }
      })
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("character/ghost.card")
  })

  it("refuses a location id with no card behind it", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: sceneCardTurn({
        patch: { target: "card", changes: [{ field: "location", value: "nowhere" }] }
      })
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("background/nowhere.card")
  })

  it("refuses a scene card proposal once the card changed", async () => {
    files.set("/workspace/scene/01-intro.card", `${sceneText}\nmood: 서늘함`)

    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: sceneEntity,
      turn: sceneCardTurn()
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("파일이 바뀌어서")
  })
})

describe("studio proposal follow-ups", () => {
  it("records the ripples an applied proposal declared", async () => {
    await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn({
        followUps: [
          {
            kind: "scene",
            key: "01-intro",
            reason: "감정 서술이 어긋납니다",
            instruction: "고쳐줘",
            targetFile: "scene/01-intro.card"
          }
        ]
      })
    })

    expect(followUpCalls.added[0]).toEqual([
      {
        id: "follow-1",
        target: { kind: "scene", key: "01-intro" },
        origin: characterEntity,
        reason: "감정 서술이 어긋납니다",
        instruction: "고쳐줘",
        createdAt: expect.any(String)
      }
    ])
  })

  it("clears whatever ripple was waiting on the edited entity", async () => {
    await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(followUpCalls.resolvedFor).toEqual([characterEntity])
    expect(followUpCalls.added[0]).toEqual([])
  })

  it("records nothing when the proposal was refused", async () => {
    files.set("/workspace/character/seorin.card", `${cardText}\ntags:\n  - 추가됨`)

    await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(followUpCalls.resolvedFor).toEqual([])
    expect(followUpCalls.added).toEqual([])
  })

  it("records nothing on a preview", async () => {
    await send(bridgeWith(), "studio.proposal.preview", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(followUpCalls.added).toEqual([])
  })
})

describe("studio proposal path safety", () => {
  it("refuses an entity key that escapes the workspace", async () => {
    const response = await send(bridgeWith(), "studio.proposal.apply", {
      entity: { kind: "character", key: "../../escape" },
      turn: proposalTurn()
    })

    expect(response.payload?.status).toBe("failed")
    expect(String(response.payload?.message)).toContain("찾을 수 없습니다")
    expect(files.get("/workspace/character/seorin.card")).toBe(cardText)
  })

  it("reports why a preview could not be shown instead of doing nothing", async () => {
    files.set("/workspace/character/seorin.card", `${cardText}\ntags:\n  - 추가됨`)

    const response = await send(bridgeWith(), "studio.proposal.preview", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect(response.payload?.shown).toBe(false)
    expect(String(response.payload?.message)).toContain("파일이 바뀌어서")
    expect(shownDiffs).toHaveLength(0)
  })
})

describe("studio proposal draft history", () => {
  const draftTurn = (): StudioChatTurn =>
    proposalTurn({
      targetFile: "draft/01-intro.md",
      patch: {
        target: "draft",
        replacements: [{ startOffset: 0, endOffset: 2, oldText: "01", newText: "XY" }]
      },
      baselineHash: hashBaseline(draftText)
    })

  it("archives the previous draft when keepHistory is on", async () => {
    keepDraftHistory = true

    await send(bridgeWith(), "studio.proposal.apply", { entity: sceneEntity, turn: draftTurn() })

    const archived = [...files.keys()].filter((path) => path.includes("/.draft/"))
    expect(archived).toHaveLength(1)
    expect(files.get(archived[0] as string)).toBe(draftText)
  })

  it("writes no archive when keepHistory is off", async () => {
    await send(bridgeWith(), "studio.proposal.apply", { entity: sceneEntity, turn: draftTurn() })

    expect([...files.keys()].filter((path) => path.includes("/.draft/"))).toEqual([])
  })

  it("never archives for a card apply", async () => {
    keepDraftHistory = true

    await send(bridgeWith(), "studio.proposal.apply", {
      entity: characterEntity,
      turn: proposalTurn()
    })

    expect([...files.keys()].filter((path) => path.includes("/.draft/"))).toEqual([])
  })
})
