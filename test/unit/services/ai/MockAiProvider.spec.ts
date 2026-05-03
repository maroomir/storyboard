import { describe, expect, it } from "vitest"

import { MockAiProvider } from "../../../../src/services/ai/providers/MockAiProvider"

describe("MockAiProvider", () => {
  it("always reports a successful connection", async () => {
    const provider = new MockAiProvider()

    await expect(provider.checkConnection()).resolves.toBe(true)
  })

  it("generates a deterministic response containing the task and user prompt", async () => {
    const provider = new MockAiProvider()

    const response = await provider.generate({
      taskName: "sceneDraft",
      messages: [{ role: "user", content: "엘리아가 학교에 도착했다." }]
    })

    expect(response).toMatchObject({
      providerId: "mock",
      model: "mock-model"
    })
    expect(response.text).toContain("[Mock AI: sceneDraft]")
    expect(response.text).toContain("엘리아가 학교에 도착했다.")
  })
})
