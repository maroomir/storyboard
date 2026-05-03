import { describe, expect, it } from "vitest"

import {
  createStoryboardErrorResponse,
  createStoryboardSuccessResponse,
  parseStoryboardRequestMessage,
  storyboardMessageProtocolVersion
} from "../../../src/shared/messaging"

describe("storyboard messaging protocol", () => {
  it("parses a supported cards.list request", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-1",
      method: "cards.list",
      payload: { type: "character" }
    })

    expect(request.method).toBe("cards.list")
    expect(request.payload).toEqual({ type: "character" })
  })

  it("rejects unsupported methods", () => {
    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "request-1",
        method: "unknown.method",
        payload: {}
      })
    ).toThrow("Unsupported Storyboard RPC method")
  })

  it("validates request payloads at the boundary", () => {
    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "request-1",
        method: "cards.read",
        payload: {}
      })
    ).toThrow()
  })

  it("parses supported ai.generate requests", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-ai-1",
      method: "ai.generate",
      payload: {
        providerId: "mock",
        taskName: "sceneDraft",
        messages: [{ role: "user", content: "샘플 장면을 생성해줘." }],
        temperature: 0.4,
        maxTokens: 100
      }
    })

    expect(request.method).toBe("ai.generate")
    expect(request.payload).toMatchObject({
      providerId: "mock",
      taskName: "sceneDraft"
    })
  })

  it("creates validated success and error responses", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-1",
      method: "cards.list",
      payload: {}
    })

    if (request.method !== "cards.list") {
      throw new Error("Expected cards.list request in this test.")
    }

    const successResponse = createStoryboardSuccessResponse(request, {
      cards: [{ type: "character", id: "elia", name: "엘리아", uri: "file:///character/elia.card" }]
    })
    const errorResponse = createStoryboardErrorResponse(request, {
      code: "test-error",
      message: "테스트 에러"
    })

    expect(successResponse.method).toBe("cards.list")
    expect(successResponse.ok).toBe(true)
    expect(successResponse.payload.cards).toHaveLength(1)
    expect(errorResponse.ok).toBe(false)
    expect(errorResponse.error.code).toBe("test-error")
  })
})
