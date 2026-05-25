import { describe, expect, it } from "vitest"

import {
  createStoryboardErrorResponse,
  createStoryboardSuccessResponse,
  parseStoryboardRequestMessage,
  storyboardMessageProtocolVersion
} from "@/shared/messaging"

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

  it("parses cards.writeRaw request", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "cards-write-raw-1",
      method: "cards.writeRaw",
      payload: {
        uri: "file:///workspace/character/elia.card",
        rawText: "type: character\nid: elia\nname: 엘리아\n"
      }
    })

    expect(request.method).toBe("cards.writeRaw")
    expect(request.payload).toEqual({
      uri: "file:///workspace/character/elia.card",
      rawText: "type: character\nid: elia\nname: 엘리아\n"
    })
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

  it("parses supported ai.generateStream requests", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "request-ai-stream-1",
      method: "ai.generateStream",
      payload: {
        providerId: "mock",
        taskName: "sceneDraft",
        messages: [{ role: "user", content: "스트리밍으로 장면을 생성해줘." }],
        temperature: 0.4,
        maxTokens: 100
      }
    })

    expect(request.method).toBe("ai.generateStream")
    expect(request.payload).toMatchObject({
      providerId: "mock",
      taskName: "sceneDraft"
    })
  })

  it("creates validated ai.generate success response preserving usage and costUsd", () => {
    const response = createStoryboardSuccessResponse(
      { id: "ai-res-1", method: "ai.generate" },
      {
        text: "ok",
        providerId: "openai",
        model: "gpt-5.4-mini",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0
        },
        costUsd: 0.000125
      }
    )

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.payload.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0
      })
      expect(response.payload.costUsd).toBe(0.000125)
    }
  })

  it("parses scenes.list and scenes.openScene requests", () => {
    const listRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "scenes-1",
      method: "scenes.list",
      payload: {}
    })
    expect(listRequest.method).toBe("scenes.list")
    expect(listRequest.payload).toEqual({})

    const openRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "scenes-2",
      method: "scenes.openScene",
      payload: { uri: "file:///workspace/scene/01-a.txt" }
    })
    expect(openRequest.method).toBe("scenes.openScene")
    expect(openRequest.payload).toEqual({ uri: "file:///workspace/scene/01-a.txt" })
  })

  it("parses scenes.generateDraft request", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "scenes-3",
      method: "scenes.generateDraft",
      payload: { uri: "file:///workspace/scene/01-a.txt" }
    })
    expect(request.method).toBe("scenes.generateDraft")
  })

  it("parses relations.list request and creates validated success response", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "relations-1",
      method: "relations.list",
      payload: {}
    })
    expect(request.method).toBe("relations.list")
    expect(request.payload).toEqual({})

    if (request.method !== "relations.list") {
      throw new Error("Expected relations.list")
    }

    const response = createStoryboardSuccessResponse(request, {
      characters: [
        {
          id: "hero",
          name: "주인공",
          role: "lead",
          uri: "file:///ws/character/hero.card",
          relations: [{ target: "rival", type: "enemy" }]
        },
        {
          id: "rival",
          name: "라이벌",
          uri: "file:///ws/character/rival.card",
          relations: [{ target: "hero", type: "enemy" }]
        }
      ]
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.payload.characters).toHaveLength(2)
      expect(response.payload.characters[0]?.relations[0]?.target).toBe("rival")
    }
  })

  it("creates validated scenes.list success response", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "scenes-4",
      method: "scenes.list",
      payload: {}
    })
    if (request.method !== "scenes.list") {
      throw new Error("Expected scenes.list")
    }
    const response = createStoryboardSuccessResponse(request, {
      scenes: [
        {
          stem: "01-prologue",
          order: 1,
          slug: "prologue",
          title: "프롤로그",
          sceneUri: "file:///ws/scene/01-prologue.txt",
          draftUri: "file:///ws/draft/01-prologue.md",
          status: "ready",
          sceneMtime: 100,
          draftMtime: 200
        }
      ]
    })
    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.payload.scenes).toHaveLength(1)
      expect(response.payload.scenes[0]?.status).toBe("ready")
    }
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
