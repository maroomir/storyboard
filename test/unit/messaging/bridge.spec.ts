import { describe, expect, it } from "vitest"

import { createWebviewBridge, type StoryboardWebviewLike } from "@/messaging/bridge"
import { storyboardMessageProtocolVersion } from "@/shared/messaging"

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

    return {
      dispose: (): void => {
        this.listener = undefined
      }
    }
  }

  public async receive(message: unknown): Promise<void> {
    await this.listener?.(message)
  }
}

describe("webview bridge", () => {
  it("routes valid requests to a registered handler", async () => {
    const webview = new FakeWebview()

    createWebviewBridge(webview, {
      "cards.list": async () => ({
        cards: [{ type: "character", id: "elia", name: "엘리아", uri: "file:///character/elia.card" }]
      })
    })

    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-1",
      method: "cards.list",
      payload: {}
    })

    expect(webview.postedMessages).toEqual([
      {
        protocolVersion: storyboardMessageProtocolVersion,
        type: "response",
        id: "request-1",
        method: "cards.list",
        ok: true,
        payload: {
          cards: [{ type: "character", id: "elia", name: "엘리아", uri: "file:///character/elia.card" }]
        }
      }
    ])
  })

  it("responds with handler-not-found when no handler is registered", async () => {
    const webview = new FakeWebview()

    createWebviewBridge(webview, {})

    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-1",
      method: "cards.list",
      payload: {}
    })

    expect(webview.postedMessages).toHaveLength(1)
    expect(webview.postedMessages[0]).toMatchObject({
      id: "request-1",
      method: "cards.list",
      ok: false,
      error: { code: "handler-not-found" }
    })
  })

  it("responds with malformed-request for invalid envelopes", async () => {
    const webview = new FakeWebview()

    createWebviewBridge(webview, {})

    await webview.receive({ type: "request" })

    expect(webview.postedMessages).toHaveLength(1)
    expect(webview.postedMessages[0]).toMatchObject({
      id: "unknown",
      method: "unknown",
      ok: false,
      error: { code: "validation-error" }
    })
  })

  it("disposes the message listener", async () => {
    const webview = new FakeWebview()
    const bridge = createWebviewBridge(webview, {
      "cards.list": async () => ({ cards: [] })
    })

    bridge.dispose()
    await webview.receive({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-1",
      method: "cards.list",
      payload: {}
    })

    expect(webview.postedMessages).toEqual([])
  })
})
