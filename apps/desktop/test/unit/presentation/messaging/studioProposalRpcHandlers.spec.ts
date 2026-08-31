import * as vscode from "vscode"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { hashBaseline } from "@/application/studio/studioChatUseCase"
import { createWebviewBridge, type StoryboardWebviewLike } from "@/presentation/messaging/bridge"
import { createStudioProposalRpcHandlers } from "@/presentation/messaging/studioProposalRpcHandlers"
import type { ProposalReviewService } from "@/presentation/providers/proposalReviewService"
import { storyboardMessageProtocolVersion } from "@/shared/messaging"
import type { StudioChatTurn, StudioEntity } from "@/shared/messaging"

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

function bridgeWith(): FakeWebview {
  const webview = new FakeWebview()
  createWebviewBridge(
    webview,
    createStudioProposalRpcHandlers({
      reviewService,
      getProjectRoot: async () => workspaceRoot
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
  shownDiffs.length = 0
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

  vi.spyOn(vscode.workspace.fs, "readDirectory").mockImplementation(async () => [])
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
        patch: { target: "draft", replacements: [{ startOffset: 0, endOffset: 2, newText: "XY" }] },
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
  const sceneCardTurn = (): StudioChatTurn =>
    proposalTurn({
      summary: "갈등 정리",
      targetFile: "scene/01-intro.card",
      patch: { target: "card", changes: [{ field: "purpose", value: "인물 소개와 갈등 암시" }] },
      baselineHash: hashBaseline(sceneText)
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
