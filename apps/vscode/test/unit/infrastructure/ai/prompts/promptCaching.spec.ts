import { describe, expect, it } from "vitest"

import {
  DraftCritiquePrompt,
  DraftRevisionPrompt,
  SceneDialoguePolishPrompt,
  SceneSectionExpansionPrompt,
  parsePromptResource,
  toPromptMessages,
  type PromptArtifact
} from "@storyboard/story-ai"

describe("prompt resource prefix section", () => {
  it("reads a ## prefix section and its cache ttl from the front-matter", () => {
    const resource = parsePromptResource(
      "sample",
      ["---", "temperature: 0.5", "maxTokens: 100", "prefixCacheTtl: 1h", "---", "## system", "규칙", "## prefix", "뼈대 {{skeleton}}", "## user", "이번 구간"].join("\n")
    )

    expect(resource.config?.prefixCacheTtl).toBe("1h")
    expect(resource.sections.get("prefix")).toBe("뼈대 {{skeleton}}")
  })

  it("rejects a ttl the providers do not offer", () => {
    expect(() =>
      parsePromptResource("sample", ["---", "temperature: 0.5", "maxTokens: 100", "prefixCacheTtl: 2h", "---", "## system", "규칙", "## user", "본문"].join("\n"))
    ).toThrow(/prefixCacheTtl/)
  })
})

describe("toPromptMessages", () => {
  it("sends the prefix as its own cached user message ahead of the tail", () => {
    expect(toPromptMessages({ system: "규칙", userPrefix: "뼈대", prefixCacheTtl: "1h", user: "이번 구간" })).toEqual([
      { role: "system", content: "규칙" },
      { role: "user", content: "뼈대", cacheBoundary: true, cacheTtl: "1h" },
      { role: "user", content: "이번 구간" }
    ])
  })

  it("keeps a prompt without a prefix, or with an empty one, as two messages", () => {
    expect(toPromptMessages({ system: "규칙", user: "본문" })).toEqual([
      { role: "system", content: "규칙" },
      { role: "user", content: "본문" }
    ])
    expect(toPromptMessages({ system: "규칙", userPrefix: "\n", user: "본문" })).toHaveLength(2)
  })
})

describe("shared prefix across the calls of one scene", () => {
  const skeleton = "⟨1⟩“가자.” 서하가 말했다.\n\n---\n\n⟨2⟩“응.” 준이 답했다."

  it("keeps system and prefix identical across the dialogue polish calls of every character", () => {
    const seoha = SceneDialoguePolishPrompt.build({
      numberedSkeleton: skeleton,
      character: { name: "서하", persona: "건조하다", catchphrases: ["그러니까"], knowledge: ["준이 늦는다"] },
      otherCharacters: ["준"],
      otherVoices: { 준: "느긋하다" }
    })
    const jun = SceneDialoguePolishPrompt.build({
      numberedSkeleton: skeleton,
      character: { name: "준", persona: "느긋하다" },
      otherCharacters: ["서하"],
      otherVoices: { 서하: "건조하다" },
      retryReasons: ["뼈대에 없는 인물이 등장합니다"]
    })

    expect(jun.system).toBe(seoha.system)
    expect(jun.userPrefix).toBe(seoha.userPrefix)
    expect(seoha.userPrefix).toContain(skeleton)
    expect(seoha.prefixCacheTtl).toBe("1h")
    expect(seoha.user).toContain("[이 인물]\n서하")
    expect(jun.user).toContain("반려됐다")
    expect(seoha.user).not.toContain(skeleton)
  })

  it("keeps system and prefix identical across the expansion calls of every section", () => {
    const style = { targetWordCount: 9000, genre: "스릴러" }
    const first = SceneSectionExpansionPrompt.build({
      skeleton,
      section: "⟨1⟩“가자.” 서하가 말했다.",
      targetLength: 1500,
      backgroundFacts: ["12층"],
      sceneCoordinates: ["1. 장소: 집 ← 이번 구간", "2. 장소: 교문"],
      style
    })
    const second = SceneSectionExpansionPrompt.build({
      skeleton,
      section: "⟨2⟩“응.” 준이 답했다.",
      previousSection: "서하가 말했다. 복도가 울렸다.",
      targetLength: 1200,
      backgroundFacts: ["[다른 자리: 집] 12층"],
      sceneCoordinates: ["1. 장소: 집", "2. 장소: 교문 ← 이번 구간"],
      retryReasons: ["분량 부족"],
      isUnderLengthRetry: true,
      style
    })

    expect(second.system).toBe(first.system)
    expect(second.userPrefix).toBe(first.userPrefix)
    expect(first.prefixCacheTtl).toBe("1h")
    expect(first.user).toContain("목표 분량: 약 1,500자")
    expect(second.user).toContain("목표 분량: 약 1,200자")
    expect(second.user).toContain("반려됐다")
    expect(second.user).toContain("[직전 구간 — 이미 완성됨]")
    expect(first.system).not.toContain("1,500")
  })

  it("keeps the critique and revision preambles ahead of the body that changes between rounds", () => {
    const critique = (body: string): PromptArtifact =>
      DraftCritiquePrompt.build({ body, intent: "첫 만남", characters: ["서하"], facts: ["눈동자는 녹색"], characterCards: ["서하 — 건조한 말투"] })
    const revision = (body: string, instructions: readonly string[]): PromptArtifact =>
      DraftRevisionPrompt.build({ body, format: "novel", instructions, intent: "첫 만남", facts: ["눈동자는 녹색"], characterCards: ["서하 — 건조한 말투"] })

    expect(critique("1판").userPrefix).toBe(critique("2판").userPrefix)
    expect(critique("1판").user).toBe("[본문]\n1판")
    expect(critique("1판").prefixCacheTtl).toBeUndefined()
    expect(revision("1판", ["반복 줄이기"]).userPrefix).toBe(revision("2판", ["설정 모순"]).userPrefix)
    expect(revision("1판", ["반복 줄이기"]).user).toContain("[지시]\n- 반복 줄이기")
    expect(revision("1판", ["반복 줄이기"]).user).toContain("[본문]\n1판")
  })
})
