import { beforeEach, describe, expect, it, vi } from "vitest"

import { StoryboardAIService } from "@/services/ai/AIService"
import { AiProviderRegistry, createAiProviderRegistry } from "@/services/ai/providerRegistry"
import { type OpenAiClientLike } from "@/services/ai/providers/OpenAiProvider"
import { type AiGenerateRequest, type AiGenerateResponse } from "@/services/ai/types"
import { GrammarCheckPrompt } from "@/services/ai/prompts/grammarCheck"
import { OutlineSynopsisPrompt } from "@/services/ai/prompts/outlineSynopsis"
import { DraftRevisionPrompt } from "@/services/ai/prompts/draftRevision"
import { InlineCompletionPrompt } from "@/services/ai/prompts/inlineCompletion"
import { SecretStore, type StoryboardSecretStorageLike } from "@/services/secrets/SecretStore"
import { ConfigBridge, type StoryboardConfigurationLike } from "@/services/settings/ConfigBridge"

const stubResponse: AiGenerateResponse = { text: "[]", providerId: "openai" }

function createRegistry(): AiProviderRegistry {
  const secretStore = new SecretStore(
    new FakeSecretStorage(new Map([["storyboard.apiKey.openai", "sk-test"]]))
  )
  const configBridge = new ConfigBridge({
    getConfiguration: (): StoryboardConfigurationLike =>
      new FakeConfiguration(
        new Map<string, unknown>([
          ["defaultProvider", "openai"],
          ["providers.openai.model", "gpt-5.4-mini"]
        ])
      )
  })

  return createAiProviderRegistry({
    secretStore,
    configBridge,
    createOpenAiClient: (): OpenAiClientLike => ({
      models: { list: async (): Promise<unknown> => ({}) },
      chat: {
        completions: {
          create: async (): Promise<{
            readonly choices: readonly [{ readonly message: { readonly content: string } }]
          }> => ({ choices: [{ message: { content: "[]" } }] })
        }
      }
    })
  })
}

interface ServiceHarness {
  readonly service: StoryboardAIService
  readonly generateSpy: ReturnType<typeof vi.fn>
}

function createHarness(): ServiceHarness {
  const registry = createRegistry()
  const generateSpy = vi.fn(async (): Promise<AiGenerateResponse> => stubResponse)
  vi.spyOn(registry, "generate").mockImplementation(generateSpy)

  return { service: new StoryboardAIService(registry), generateSpy }
}

function lastRequest(generateSpy: ReturnType<typeof vi.fn>): AiGenerateRequest {
  const call = generateSpy.mock.calls.at(-1)
  expect(call).toBeDefined()
  return call![0] as AiGenerateRequest
}

describe("StoryboardAIService temperature/maxTokens contract", () => {
  let harness: ServiceHarness

  beforeEach(() => {
    harness = createHarness()
  })

  describe("Family A — no defaulting (options pass straight through)", () => {
    const character = {
      type: "character" as const,
      id: "elia",
      name: "엘리아",
      description: ["주인공"],
      tags: [],
      traits: ["용감함"],
      relations: [],
      arc: [],
      recentDialogues: []
    }

    it("createCharacterPersona with no options sends undefined temperature/maxTokens for personaGeneration", async () => {
      await harness.service.createCharacterPersona(character)

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("personaGeneration")
      expect(request.temperature).toBeUndefined()
      expect(request.maxTokens).toBeUndefined()
    })

    it("createCharacterPersona forwards an explicit override verbatim", async () => {
      await harness.service.createCharacterPersona(character, { temperature: 0.1, maxTokens: 50 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("personaGeneration")
      expect(request.temperature).toBe(0.1)
      expect(request.maxTokens).toBe(50)
    })

    it("applyGenreFormat with no options sends undefined temperature/maxTokens for sceneDraft", async () => {
      await harness.service.applyGenreFormat("대화 본문", "novel")

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("sceneDraft")
      expect(request.temperature).toBeUndefined()
      expect(request.maxTokens).toBeUndefined()
    })

    it("applyGenreFormat forwards an explicit override verbatim", async () => {
      await harness.service.applyGenreFormat("대화 본문", "novel", { temperature: 0.1, maxTokens: 50 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("sceneDraft")
      expect(request.temperature).toBe(0.1)
      expect(request.maxTokens).toBe(50)
    })
  })

  describe("Family B — defaults to prompt config when caller omits values", () => {
    it("checkGrammar defaults to GrammarCheckPrompt.config for grammarCheck", async () => {
      await harness.service.checkGrammar("이건 정말루 중요해.")

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("grammarCheck")
      expect(request.temperature).toBe(GrammarCheckPrompt.config.temperature)
      expect(request.maxTokens).toBe(GrammarCheckPrompt.config.maxTokens)
    })

    it("checkGrammar respects a caller override over the config", async () => {
      await harness.service.checkGrammar("이건 정말루 중요해.", { temperature: 0.9, maxTokens: 11 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("grammarCheck")
      expect(request.temperature).toBe(0.9)
      expect(request.maxTokens).toBe(11)
    })

    it("generateOutlineSynopsis defaults to OutlineSynopsisPrompt.config for outlineSynopsis", async () => {
      await harness.service.generateOutlineSynopsis(outlineBrief)

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("outlineSynopsis")
      expect(request.temperature).toBe(OutlineSynopsisPrompt.config.temperature)
      expect(request.maxTokens).toBe(OutlineSynopsisPrompt.config.maxTokens)
    })

    it("generateOutlineSynopsis respects a caller override over the config", async () => {
      await harness.service.generateOutlineSynopsis(outlineBrief, { temperature: 0.2, maxTokens: 33 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("outlineSynopsis")
      expect(request.temperature).toBe(0.2)
      expect(request.maxTokens).toBe(33)
    })

    it("reviseDraft defaults to DraftRevisionPrompt.config for draftRevision", async () => {
      await harness.service.reviseDraft(draftRevisionInput)

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("draftRevision")
      expect(request.temperature).toBe(DraftRevisionPrompt.config.temperature)
      expect(request.maxTokens).toBe(DraftRevisionPrompt.config.maxTokens)
    })

    it("reviseDraft respects a caller override over the config", async () => {
      await harness.service.reviseDraft(draftRevisionInput, { temperature: 0.4, maxTokens: 77 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("draftRevision")
      expect(request.temperature).toBe(0.4)
      expect(request.maxTokens).toBe(77)
    })

    it("completeInline defaults to InlineCompletionPrompt.config for inlineCompletion", async () => {
      await harness.service.completeInline("그는 창밖을 보며", {})

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("inlineCompletion")
      expect(request.temperature).toBe(InlineCompletionPrompt.config.temperature)
      expect(request.maxTokens).toBe(InlineCompletionPrompt.config.maxTokens)
    })

    it("completeInline respects a caller override over the config", async () => {
      await harness.service.completeInline("그는 창밖을 보며", {}, { temperature: 0.8, maxTokens: 9 })

      const request = lastRequest(harness.generateSpy)
      expect(request.taskName).toBe("inlineCompletion")
      expect(request.temperature).toBe(0.8)
      expect(request.maxTokens).toBe(9)
    })
  })
})

const outlineBrief = {
  projectName: "테스트 소설",
  format: "novel" as const,
  language: "ko",
  tags: [],
  prohibitions: [],
  styleConstraints: [],
  qualityCriteria: []
}

const draftRevisionInput = {
  body: "원본 본문",
  format: "novel" as const,
  instructions: ["보이스를 일관되게"],
  intent: "씬 의도",
  facts: []
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
