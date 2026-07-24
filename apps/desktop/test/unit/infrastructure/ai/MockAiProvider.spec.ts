import { describe, expect, it } from "vitest"

import { MockAiProvider } from '@storyboard/story-ai';

describe("MockAiProvider", () => {
  it("always reports a successful connection", async () => {
    const provider = new MockAiProvider()

    await expect(provider.checkConnection()).resolves.toBe(true)
  })

  it("generates a deterministic draft response containing the task and user prompt", async () => {
    const provider = new MockAiProvider()

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "엘리아가 학교에 도착했다." }]
    })

    const promptChars = "엘리아가 학교에 도착했다.".length
    expect(response).toMatchObject({
      providerId: "mock",
      model: "mock-default",
      usage: {
        inputTokens: Math.floor(promptChars / 4),
        outputTokens: Math.floor(response.text.length / 4)
      },
      costUsd: 0
    })
    expect(response.text).toContain("[Mock AI: sceneDraft]")
    expect(response.text).toContain("엘리아가 학교에 도착했다.")
  })

  it("returns valid JSON for situation extraction so the draft pipeline works with the default provider", async () => {
    const provider = new MockAiProvider()

    const response = await provider.generate({
      taskName: "situationExtraction",
      messages: [
        {
          role: "user",
          content: [
            "Analyze text.",
            "",
            "User Input:",
            "엘리아가 학교에 도착했다.",
            "",
            "Output only the JSON array."
          ].join("\n")
        }
      ]
    })

    expect(JSON.parse(response.text)).toEqual([
      {
        characters: [],
        situation: "엘리아가 학교에 도착했다."
      }
    ])
  })

  it("returns structured JSON issues for grammarCheck", async () => {
    const provider = new MockAiProvider()

    const response = await provider.generate({
      taskName: "grammarCheck",
      messages: [{ role: "user", content: "그는 정말루 침착했다." }]
    })

    expect(JSON.parse(response.text)).toEqual([
      expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
        original: expect.any(String),
        suggestion: expect.any(String),
        reason: expect.any(String)
      })
    ])
  })

  it("returns deterministic text for inlineCompletion and draftExpansion", async () => {
    const provider = new MockAiProvider()

    const inlineResponse = await provider.generate({
      taskName: "inlineCompletion",
      messages: [{ role: "user", content: "그는 창문을 닫고" }]
    })
    const expansionResponse = await provider.generate({
      taskName: "draftExpansion",
      messages: [{ role: "user", content: "그는 문을 열었다." }]
    })

    expect(inlineResponse.text).toContain("다음 말을 조심스럽게 이어 갔다.")
    expect(expansionResponse.text).toContain("주변 공기는 묵직했고")
  })
})
