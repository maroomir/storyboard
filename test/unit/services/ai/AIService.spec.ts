import { describe, expect, it } from "vitest"

import { StoryboardAIService } from "@/services/ai/AIService"
import { createAiProviderRegistry } from "@/services/ai/providerRegistry"
import { type OpenAiClientLike } from "@/services/ai/providers/OpenAiProvider"
import { type AiMessage } from "@/shared/aiTypes"
import { SecretStore, type StoryboardSecretStorageLike } from "@/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "@/services/settings/ConfigBridge"

describe("StoryboardAIService", () => {
  it("extracts situations from JSON-shaped model output", async () => {
    const service = createAIService({
      completionText:
        '[{"characters":["엘리아","지훈"],"situation":"엘리아와 지훈이 교실에서 대화한다."}]'
    })

    await expect(service.extractSituations("엘리아와 지훈이 교실에서 대화한다.")).resolves.toEqual([
      {
        characters: ["엘리아", "지훈"],
        situation: "엘리아와 지훈이 교실에서 대화한다."
      }
    ])
  })

  it("builds persona and genre-format requests through the registry", async () => {
    const service = createAIService({ completionText: "나는 엘리아다." })

    await expect(
      service.createCharacterPersona({
        type: "character",
        id: "elia",
        name: "엘리아",
        description: ["주인공"],
        tags: [],
        traits: ["용감함"],
        relations: [],
        arc: [],
        recentDialogues: []
      })
    ).resolves.toBe("나는 엘리아다.")
  })

  it("returns trimmed background atmosphere through the registry", async () => {
    const service = createAIService({ completionText: "  분필 냄새가 떠도는 오후의 정적.  " })

    await expect(
      service.describeBackground({
        type: "location",
        id: "school-hall",
        name: "복도",
        locationKind: "place",
        description: ["낡은 복도"],
        characterIds: [],
        tags: ["학교"]
      })
    ).resolves.toBe("분필 냄새가 떠도는 오후의 정적.")
  })

  it("parses traits bullets per character from model output", async () => {
    const service = createAIService({
      completionText: `- 활발하게 교실 앞으로 걸어 나섬
- 친구를 안심시키며 또렷하게 말함`
    })

    await expect(service.extractTraitsByCharacter("엘리아가 앞으로 나선다.", ["엘리아"])).resolves.toEqual({
      엘리아: ["활발하게 교실 앞으로 걸어 나섬", "친구를 안심시키며 또렷하게 말함"]
    })
  })

  it("parses grammar issues from JSON array output", async () => {
    const service = createAIService({
      completionText:
        '[{"start":2,"end":6,"original":"정말루","suggestion":"정말로","reason":"표준어 표현으로 교정"}]'
    })

    await expect(service.checkGrammar("이건 정말루 중요해.")).resolves.toEqual([
      {
        start: 2,
        end: 6,
        original: "정말루",
        suggestion: "정말로",
        reason: "표준어 표현으로 교정"
      }
    ])
  })

  it("parses setting facts per character from JSON array output", async () => {
    const service = createAIService({
      completionText: '[{"key":"눈동자 색","value":"녹색"},{"key":"나이","value":"17"}]'
    })

    await expect(service.extractFactsByCharacter("엘리아가 걸어왔다.", ["엘리아"])).resolves.toEqual({
      엘리아: [
        { key: "눈동자 색", value: "녹색" },
        { key: "나이", value: "17" }
      ]
    })
  })

  it("parses card candidate fields per character from JSON object output", async () => {
    const service = createAIService({
      completionText:
        '{"attributes":[{"key":"나이","value":"17"}],"relations":[{"target":"지훈","type":"친구"}],"arc":{"summary":"학교에 도착해 친구를 만남"}}'
    })

    await expect(service.extractCardCandidatesByCharacter("엘리아가 지훈을 만났다.", ["엘리아"])).resolves.toEqual({
      엘리아: {
        attributes: [{ key: "나이", value: "17" }],
        relations: [{ target: "지훈", type: "친구" }],
        description: [],
        voice: [],
        desire: [],
        arc: { summary: "학교에 도착해 친구를 만남" }
      }
    })
  })

  it("parses approved candidate indices from JSON array output", async () => {
    const service = createAIService({ completionText: "[0, 2]" })

    await expect(
      service.verifyCardCandidatesByCharacter("엘리아가 지훈을 만났다.", "엘리아", [
        "속성 나이: 17",
        "관계 지훈: 친구",
        "아크: 학교에 도착"
      ])
    ).resolves.toEqual([0, 2])
  })

  it("returns null when verification output is not a JSON array", async () => {
    const service = createAIService({ completionText: "확인 불가" })

    await expect(
      service.verifyCardCandidatesByCharacter("본문", "엘리아", ["속성 나이: 17"])
    ).resolves.toBeNull()
  })

  it("Q8: parses continuity issues and defaults missing severity to high", async () => {
    const service = createAIService({
      completionText:
        '[{"start":0,"end":5,"original":"파란 눈","reason":"설정상 엘리아의 눈동자 색은 녹색"}]'
    })

    await expect(
      service.checkContinuity("파란 눈의 엘리아가 걸어왔다.", ["엘리아 — 눈동자 색: 녹색"])
    ).resolves.toEqual([
      {
        start: 0,
        end: 5,
        original: "파란 눈",
        reason: "설정상 엘리아의 눈동자 색은 녹색",
        severity: "high"
      }
    ])
  })

  it("Q9: defaults invalid severity values to high", async () => {
    const service = createAIService({
      completionText:
        '[{"start":0,"end":5,"original":"파란 눈","reason":"색 모순","severity":"critical"},{"start":6,"end":9,"original":"엘리아","reason":"이름 모순","severity":123}]'
    })

    const issues = await service.checkContinuity("파란 눈의 엘리아가 걸어왔다.", ["엘리아 — 눈동자 색: 녹색"])

    expect(issues).toHaveLength(2)
    expect(issues[0]?.severity).toBe("high")
    expect(issues[1]?.severity).toBe("high")
  })

  it("Q10: preserves an explicit low severity", async () => {
    const service = createAIService({
      completionText:
        '[{"start":0,"end":5,"original":"파란 눈","reason":"색 모순","severity":"low"}]'
    })

    await expect(
      service.checkContinuity("파란 눈의 엘리아가 걸어왔다.", ["엘리아 — 눈동자 색: 녹색"])
    ).resolves.toEqual([
      {
        start: 0,
        end: 5,
        original: "파란 눈",
        reason: "색 모순",
        severity: "low"
      }
    ])
  })

  it("skips the model call and returns nothing when no facts are provided", async () => {
    const capture: MessageCapture = {}
    const service = createAIService({ completionText: "[]", capture })

    await expect(service.checkContinuity("아무 본문", [])).resolves.toEqual([])
    expect(capture.lastMessages).toBeUndefined()
  })

  it("returns trimmed text for inline completion and draft expansion", async () => {
    const service = createAIService({
      completionText: "  그는 잠시 웃으며 고개를 끄덕였다.  "
    })

    await expect(
      service.completeInline("그는 창밖을 보며", {
        activeCharacter: "엘리아",
        background: "학교 복도"
      })
    ).resolves.toBe("그는 잠시 웃으며 고개를 끄덕였다.")

    await expect(
      service.expandDraft("그는 문을 열었다.", {
        activeCharacter: "엘리아",
        background: "학교 복도"
      })
    ).resolves.toBe("그는 잠시 웃으며 고개를 끄덕였다.")
  })

  it("returns trimmed text for draft augment", async () => {
    const service = createAIService({
      completionText: "  그는 잠시 웃으며 고개를 끄덕였다.  "
    })

    await expect(
      service.augmentDraft({
        target: "그는 문을 열었다.",
        scope: "selection",
        format: "novel",
        cards: ["[엘리아] 역할: main"],
        facts: ["엘리아 — 눈동자 색: 녹색"]
      })
    ).resolves.toBe("그는 잠시 웃으며 고개를 끄덕였다.")
  })

  it("sends prompt as separated system/user messages", async () => {
    const capture: MessageCapture = {}
    const service = createAIService({ completionText: "[]", capture })

    await service.checkGrammar("이건 정말루 중요해.")

    expect(capture.lastMessages).toBeDefined()
    expect(capture.lastMessages).toHaveLength(2)
    expect(capture.lastMessages?.[0]?.role).toBe("system")
    expect(capture.lastMessages?.[1]?.role).toBe("user")
    expect(capture.lastMessages?.[1]?.content).toContain("이건 정말루 중요해.")
  })

  it("skips the model call and returns nothing when no beats are provided for coverage", async () => {
    const capture: MessageCapture = {}
    const service = createAIService({ completionText: "[]", capture })

    await expect(service.checkSceneCoverage([], "엘리아가 복도를 걸었다.")).resolves.toEqual([])
    expect(capture.lastMessages).toBeUndefined()
  })

  it("calls the registry once and coerces the scene-coverage response", async () => {
    const capture: MessageCapture = {}
    const service = createAIService({
      completionText: '[{"index":2,"status":"missing","note":"잠긴 문 장면이 빠짐"},{"index":5,"status":"missing"}]',
      capture
    })

    const issues = await service.checkSceneCoverage(
      ["엘리아가 복도를 걷는다.", "잠긴 문 앞에 선다.", "문이 열린다."],
      "엘리아는 복도를 걸었고 문이 열렸다."
    )

    expect(issues).toEqual([{ index: 2, status: "missing", note: "잠긴 문 장면이 빠짐" }])
    expect(capture.lastMessages).toBeDefined()
    expect(capture.lastMessages?.[1]?.content).toContain("엘리아는 복도를 걸었고 문이 열렸다.")
  })

  it("uses xs prompt variant when provider is ollama", async () => {
    const capture: MessageCapture = {}
    const service = createAIService({ completionText: "[]", capture, defaultProvider: "ollama" })

    await service.checkGrammar("이건 정말루 중요해.")

    expect(capture.lastProviderId).toBe("ollama")
    expect(capture.lastMessages).toBeDefined()
    expect(capture.lastMessages?.[0]?.role).toBe("system")
    expect(capture.lastMessages?.[0]?.content.length ?? 0).toBeLessThan(140)
  })
})

interface MessageCapture {
  lastMessages?: readonly AiMessage[]
  lastProviderId?: string
}

function createAIService(options: {
  readonly completionText: string
  readonly defaultProvider?: "openai" | "ollama"
  readonly capture?: MessageCapture
}): StoryboardAIService {
  const secretStore = new SecretStore(new FakeSecretStorage(new Map([["storyboard.apiKey.openai", "sk-test"]])))
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike =>
      new FakeConfiguration(
        new Map<string, unknown>([
          ["defaultProvider", options.defaultProvider ?? "openai"],
          ["providers.openai.model", "gpt-5.4-mini"],
          ["providers.ollama.baseUrl", "http://localhost:11434"],
          ["providers.ollama.model", "llama3.3"]
        ])
      )
  })

  return new StoryboardAIService(
    createAiProviderRegistry({
      secretStore,
      configBridge,
      createOpenAiClient: (): OpenAiClientLike => ({
        models: {
          list: async (): Promise<unknown> => ({})
        },
        chat: {
          completions: {
            create: async (request: { readonly messages: readonly AiMessage[] }): Promise<{ readonly choices: readonly [{ readonly message: { readonly content: string } }] }> => {
              if (options.capture) {
                options.capture.lastMessages = request.messages
                options.capture.lastProviderId = "openai"
              }
              return {
                choices: [{ message: { content: options.completionText } }]
              }
            }
          }
        }
      }),
      createOllamaClient: () => ({
        get: async (): Promise<unknown> => ({}),
        post: async (
          _path: string,
          body: { readonly messages: readonly AiMessage[] }
        ): Promise<{ readonly message: { readonly content: string } }> => {
          if (options.capture) {
            options.capture.lastMessages = body.messages
            options.capture.lastProviderId = "ollama"
          }
          return {
            message: { content: options.completionText }
          }
        }
      })
    })
  )
}

class FakeSecretStorage implements StoryboardSecretStorageLike {
  public constructor(private readonly values: Map<string, string>) {}

  public async get(key: string): Promise<string | undefined> {
    return this.values.get(key)
  }

  public async store(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  public async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

class FakeConfiguration implements StoryboardConfigurationLike {
  public constructor(private readonly values: ReadonlyMap<string, unknown>) {}

  public get<T>(section: string, defaultValue: T): T {
    return (this.values.has(section) ? this.values.get(section) : defaultValue) as T
  }
}
