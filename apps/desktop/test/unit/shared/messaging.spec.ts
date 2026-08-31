import { describe, expect, it } from "vitest"

import {
  aiProvidersCheckConnectionResponsePayloadSchema,
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

  it("parses project.readContract and project.updateContract requests", () => {
    const readRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "contract-1",
      method: "project.readContract",
      payload: {}
    })
    expect(readRequest.method).toBe("project.readContract")

    const updateRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "contract-2",
      method: "project.updateContract",
      payload: {
        genre: "성장 판타지",
        audience: "10대 후반",
        pov: "third-limited",
        targetWordCount: 120000,
        prohibitions: ["과도한 폭력"]
      }
    })
    expect(updateRequest.method).toBe("project.updateContract")
    expect(updateRequest.payload).toMatchObject({ pov: "third-limited", targetWordCount: 120000 })
  })

  it("creates a validated project.readContract success response", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "contract-3",
      method: "project.readContract",
      payload: {}
    })
    if (request.method !== "project.readContract") {
      throw new Error("Expected project.readContract")
    }

    const response = createStoryboardSuccessResponse(request, {
      isStoryboardProject: true,
      format: "novel",
      setting: { genre: "판타지", prohibitions: [], styleConstraints: [], qualityCriteria: [] },
      readiness: { isReady: false, missing: ["audience", "pov", "targetWordCount"], warnings: [] }
    })

    expect(response.ok).toBe(true)
    if (response.ok) {
      expect(response.payload.readiness.missing).toContain("audience")
    }
  })

  it("rejects an invalid point of view in project.updateContract", () => {
    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "contract-4",
        method: "project.updateContract",
        payload: { pov: "omniscient" }
      })
    ).toThrow()
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

  it("parses settings.updateProviderCommand for CLI providers and rejects others", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "command-1",
      method: "settings.updateProviderCommand",
      payload: { providerId: "claude-code", command: "/usr/local/bin/claude" }
    })
    expect(request.method).toBe("settings.updateProviderCommand")
    expect(request.payload).toEqual({ providerId: "claude-code", command: "/usr/local/bin/claude" })

    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "command-2",
        method: "settings.updateProviderCommand",
        payload: { providerId: "openai", command: "claude" }
      })
    ).toThrow()

    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "command-3",
        method: "settings.updateProviderCommand",
        payload: { providerId: "codex", command: "   " }
      })
    ).toThrow()
  })

  it("validates checkConnection responses with an optional reason discriminator", () => {
    expect(aiProvidersCheckConnectionResponsePayloadSchema.parse({ ok: true })).toEqual({ ok: true })
    expect(
      aiProvidersCheckConnectionResponsePayloadSchema.parse({ ok: false, reason: "not-installed" })
    ).toEqual({ ok: false, reason: "not-installed" })
    expect(() =>
      aiProvidersCheckConnectionResponsePayloadSchema.parse({ ok: false, reason: "exploded" })
    ).toThrow()
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

  it("parses studio.session.save and rejects an empty turn list", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "studio-save-1",
      method: "studio.session.save",
      payload: {
        id: "11111111-1111-1111-1111-111111111111",
        entity: { kind: "scene", key: "01-intro" },
        createdAt: "2026-07-19T00:00:00.000Z",
        hasAppliedChanges: false,
        turns: [{ id: "u1", role: "user", text: "맞춤법 봐줘" }]
      }
    })
    expect(request.method).toBe("studio.session.save")

    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "studio-save-2",
        method: "studio.session.save",
        payload: {
          id: "11111111-1111-1111-1111-111111111111",
          entity: { kind: "scene", key: "01-intro" },
          createdAt: "2026-07-19T00:00:00.000Z",
          hasAppliedChanges: false,
          turns: []
        }
      })
    ).toThrow()
  })

  it("keeps a proposal turn with its patch, baseline and verdict", () => {
    const request = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "studio-save-3",
      method: "studio.session.save",
      payload: {
        id: "11111111-1111-1111-1111-111111111111",
        entity: { kind: "character", key: "seorin" },
        createdAt: "2026-07-19T00:00:00.000Z",
        hasAppliedChanges: true,
        turns: [
          {
            id: "a1",
            role: "assistant",
            kind: "proposal",
            summary: "과거사 추가",
            patch: { target: "card", changes: [{ field: "description", value: ["화재"] }] },
            baselineHash: "hash-1",
            validation: { state: "pass", warnings: [] },
            status: "applied"
          }
        ]
      }
    })

    if (request.method !== "studio.session.save") {
      throw new Error("Expected studio.session.save")
    }
    expect(request.payload.turns[0]).toMatchObject({ kind: "proposal", baselineHash: "hash-1" })
  })

  it("rejects a proposal turn with a backwards draft range", () => {
    expect(() =>
      parseStoryboardRequestMessage({
        protocolVersion: storyboardMessageProtocolVersion,
        type: "request",
        id: "studio-save-4",
        method: "studio.session.save",
        payload: {
          id: "11111111-1111-1111-1111-111111111111",
          entity: { kind: "scene", key: "01-intro" },
          createdAt: "2026-07-19T00:00:00.000Z",
          hasAppliedChanges: false,
          turns: [
            {
              id: "a1",
              role: "assistant",
              kind: "proposal",
              summary: "구간 수정",
              patch: { target: "draft", replacements: [] },
              baselineHash: "hash-1",
              validation: { state: "pass", warnings: [] },
              status: "pending"
            }
          ]
        }
      })
    ).toThrow()
  })

  it("parses studio.session.list and studio.session.load requests", () => {
    const listRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "studio-list-1",
      method: "studio.session.list",
      payload: { entity: { kind: "character", key: "seorin" } }
    })
    expect(listRequest.method).toBe("studio.session.list")

    const loadRequest = parseStoryboardRequestMessage({
      protocolVersion: storyboardMessageProtocolVersion,
      type: "request",
      id: "studio-load-1",
      method: "studio.session.load",
      payload: {
        entity: { kind: "character", key: "seorin" },
        id: "11111111-1111-1111-1111-111111111111"
      }
    })
    expect(loadRequest.method).toBe("studio.session.load")
    expect(loadRequest.payload).toEqual({
      entity: { kind: "character", key: "seorin" },
      id: "11111111-1111-1111-1111-111111111111"
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
