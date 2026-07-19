import { describe, expect, it } from "vitest"

import { createWebviewBridge, type StoryboardWebviewLike } from "@/presentation/messaging/bridge"
import { createStudioSessionRpcHandlers } from "@/presentation/messaging/studioSessionRpcHandlers"
import { storyboardMessageProtocolVersion } from "@/shared/messaging"
import type {
  IStudioSessionRepository,
  StudioSessionSaveInput
} from "@/infrastructure/persistence/repositories/studioSessionRepository"
import type { StudioSessionSnapshot, StudioSessionSummary } from "@/shared/messaging"

const fakeRoot = { toString: () => "file:///workspace" } as never

class FakeStudioSessionRepository implements IStudioSessionRepository {
  public readonly saved: StudioSessionSaveInput[] = []
  public readonly loadedIds: string[] = []

  public constructor(
    private readonly summaries: readonly StudioSessionSummary[] = [],
    private readonly snapshot: StudioSessionSnapshot | undefined = undefined
  ) {}

  public async save(_root: unknown, input: StudioSessionSaveInput): Promise<void> {
    this.saved.push(input)
  }

  public async list(): Promise<readonly StudioSessionSummary[]> {
    return this.summaries
  }

  public async load(_root: unknown, id: string): Promise<StudioSessionSnapshot | undefined> {
    this.loadedIds.push(id)
    return this.snapshot
  }

  public async loadLatest(): Promise<StudioSessionSnapshot | undefined> {
    return this.snapshot
  }
}

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

function request(method: string, payload: unknown, id: string): unknown {
  return { protocolVersion: storyboardMessageProtocolVersion, type: "request", id, method, payload }
}

function lastResponse(webview: FakeWebview): { ok: boolean; payload?: Record<string, unknown> } {
  return webview.postedMessages.at(-1) as { ok: boolean; payload?: Record<string, unknown> }
}

describe("studio session rpc handlers", () => {
  it("routes a save to the repository with derived args", async () => {
    const repository = new FakeStudioSessionRepository()
    const webview = new FakeWebview()
    createWebviewBridge(
      webview,
      createStudioSessionRpcHandlers({ repository, getProjectRoot: async () => fakeRoot })
    )

    await webview.receive(
      request(
        "studio.session.save",
        {
          id: "11111111-1111-1111-1111-111111111111",
          createdAt: "2026-07-19T00:00:00.000Z",
          turns: [{ id: "u1", role: "user", text: "맞춤법 봐줘" }]
        },
        "save-1"
      )
    )

    expect(repository.saved).toHaveLength(1)
    expect(repository.saved[0]?.id).toBe("11111111-1111-1111-1111-111111111111")
    expect(lastResponse(webview).ok).toBe(true)
  })

  it("returns repository summaries for a list request", async () => {
    const summaries: StudioSessionSummary[] = [
      { id: "s1", title: "지난 대화", updatedAt: "2026-07-18T09:00:00.000Z", turnCount: 2 }
    ]
    const repository = new FakeStudioSessionRepository(summaries)
    const webview = new FakeWebview()
    createWebviewBridge(
      webview,
      createStudioSessionRpcHandlers({ repository, getProjectRoot: async () => fakeRoot })
    )

    await webview.receive(request("studio.session.list", {}, "list-1"))

    expect(lastResponse(webview).payload?.sessions).toEqual(summaries)
  })

  it("returns an undefined session for an unknown load id", async () => {
    const repository = new FakeStudioSessionRepository()
    const webview = new FakeWebview()
    createWebviewBridge(
      webview,
      createStudioSessionRpcHandlers({ repository, getProjectRoot: async () => fakeRoot })
    )

    await webview.receive(request("studio.session.load", { id: "missing" }, "load-1"))

    expect(repository.loadedIds).toEqual(["missing"])
    expect(lastResponse(webview).payload?.session).toBeUndefined()
  })

  it("skips the repository when there is no storyboard project", async () => {
    const repository = new FakeStudioSessionRepository()
    const webview = new FakeWebview()
    createWebviewBridge(
      webview,
      createStudioSessionRpcHandlers({ repository, getProjectRoot: async () => undefined })
    )

    await webview.receive(
      request(
        "studio.session.save",
        {
          id: "11111111-1111-1111-1111-111111111111",
          createdAt: "2026-07-19T00:00:00.000Z",
          turns: [{ id: "u1", role: "user", text: "맞춤법 봐줘" }]
        },
        "save-2"
      )
    )
    await webview.receive(request("studio.session.list", {}, "list-2"))

    expect(repository.saved).toHaveLength(0)
    expect(lastResponse(webview).payload?.sessions).toEqual([])
  })
})
