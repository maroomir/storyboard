import type { Background } from "@/domain/Background"
import type { Character } from "@/domain/Character"
import type { ProjectFormat } from "@/shared/project"
import { AiProviderRegistry } from "./providerRegistry"
import type {
  AiGenerateResponse,
  AiProviderId,
  UsageAttribution,
  UsageRecord,
  WiredAiTaskName
} from "./types"
import { DraftExpansionPrompt } from "./prompts/draftExpansion"
import { GenreFormattingPrompt } from "./prompts/genreFormatting"
import { GrammarCheckPrompt } from "./prompts/grammarCheck"
import { InlineCompletionPrompt } from "./prompts/inlineCompletion"
import { PersonaDialoguePrompt } from "./prompts/personaDialogue"
import { PersonaGenerationPrompt } from "./prompts/personaGeneration"
import { SituationExtractionPrompt } from "./prompts/situationExtraction"
import { TraitsExtractionPrompt } from "./prompts/traitsExtraction"
import { parseBulletList, parseJsonArray } from "@/utils/aiResponseParser"

export interface SituationWithCharacters {
  readonly characters: readonly string[]
  readonly situation: string
}

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId
  readonly temperature?: number
  readonly maxTokens?: number
  readonly attribution?: UsageAttribution
}

export interface ExtractTraitsByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined
}

export interface GrammarIssue {
  readonly start: number
  readonly end: number
  readonly original: string
  readonly suggestion: string
  readonly reason: string
}

export interface InlineCompletionContext {
  readonly activeCharacter?: string
  readonly background?: string
}

export interface DraftExpansionContext {
  readonly activeCharacter?: string
  readonly background?: string
}

export type OnUsageRecordCallback = (record: UsageRecord) => void

export interface StoryboardAIServiceOptions {
  readonly onUsage?: OnUsageRecordCallback
}

export class StoryboardAIService {
  public constructor(
    private readonly registry: AiProviderRegistry,
    private readonly serviceOptions: StoryboardAIServiceOptions = {}
  ) {}

  public async extractSituations(
    input: string,
    options: GenerateTextOptions = {}
  ): Promise<SituationWithCharacters[]> {
    const response = await this.generateText(
      "situationExtraction",
      [{ role: "user", content: SituationExtractionPrompt.build(input) }],
      options
    )
    const parsedArray = parseJsonArray(response.text)

    if (!parsedArray) {
      return []
    }

    return parsedArray.flatMap((item) => toSituationWithCharacters(item))
  }

  public async createCharacterPersona(
    character: Character,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const response = await this.generateText(
      "personaGeneration",
      [{ role: "user", content: PersonaGenerationPrompt.build(character) }],
      options
    )

    return response.text.trim()
  }

  public async generatePersonaDialogue(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const prompt = PersonaDialoguePrompt.build(situation, personas, background, previousContext)
    const response = await this.generateText(
      "personaDialogue",
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      options
    )

    return response.text.trim()
  }

  public async applyGenreFormat(
    dialogue: string,
    format: ProjectFormat,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const response = await this.generateText(
      "sceneDraft",
      [{ role: "user", content: GenreFormattingPrompt.build(dialogue, format) }],
      options
    )

    return response.text.trim()
  }

  public async extractTraitsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractTraitsByCharacterOptions = {}
  ): Promise<Record<string, string[]>> {
    const uniqueNames = [...new Set(characterNames.map((name) => name.trim()).filter((name) => name.length > 0))]
    const traitOptions: ExtractTraitsByCharacterOptions = {
      ...options,
      temperature: options.temperature ?? TraitsExtractionPrompt.config.temperature,
      maxTokens: options.maxTokens ?? TraitsExtractionPrompt.config.maxTokens
    }

    const entries = await Promise.all(
      uniqueNames.map(async (name) => {
        const attribution = traitOptions.attributionForCharacter?.(name) ?? traitOptions.attribution
        const response = await this.generateText(
          "traitsExtraction",
          [{ role: "user", content: TraitsExtractionPrompt.build(draftBody, name) }],
          {
            ...traitOptions,
            attribution
          }
        )

        return [name, parseBulletList(response.text)] as const
      })
    )

    return Object.fromEntries(entries)
  }

  public async checkGrammar(body: string, options: GenerateTextOptions = {}): Promise<GrammarIssue[]> {
    const response = await this.generateText(
      "grammarCheck",
      [{ role: "user", content: GrammarCheckPrompt.build(body) }],
      {
        ...options,
        temperature: options.temperature ?? GrammarCheckPrompt.config.temperature,
        maxTokens: options.maxTokens ?? GrammarCheckPrompt.config.maxTokens
      }
    )
    const parsedArray = parseJsonArray(response.text)

    if (!parsedArray) {
      return []
    }

    return parsedArray.flatMap((value) => toGrammarIssue(value))
  }

  public async completeInline(
    prefix: string,
    context: InlineCompletionContext = {},
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const response = await this.generateText(
      "inlineCompletion",
      [{ role: "user", content: InlineCompletionPrompt.build(prefix, context) }],
      {
        ...options,
        temperature: options.temperature ?? InlineCompletionPrompt.config.temperature,
        maxTokens: options.maxTokens ?? InlineCompletionPrompt.config.maxTokens
      }
    )

    return response.text.trim()
  }

  public async expandDraft(
    selection: string,
    context: DraftExpansionContext = {},
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const response = await this.generateText(
      "draftExpansion",
      [{ role: "user", content: DraftExpansionPrompt.build(selection, context) }],
      {
        ...options,
        temperature: options.temperature ?? DraftExpansionPrompt.config.temperature,
        maxTokens: options.maxTokens ?? DraftExpansionPrompt.config.maxTokens
      }
    )

    return response.text.trim()
  }

  private async generateText(
    taskName: WiredAiTaskName,
    messages: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>,
    options: GenerateTextOptions
  ): Promise<AiGenerateResponse> {
    const response = options.providerId
      ? await this.registry.generateWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        })
      : await this.registry.generate({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        })

    this.emitUsageIfNeeded(taskName, response, options.attribution)
    return response
  }

  private emitUsageIfNeeded(
    taskName: UsageRecord["taskName"],
    response: AiGenerateResponse,
    attribution: UsageAttribution | undefined
  ): void {
    const onUsage = this.serviceOptions.onUsage

    if (!onUsage || !attribution || !isAttributed(attribution)) {
      return
    }

    onUsage({
      taskName,
      providerId: response.providerId,
      model: response.model,
      usage: response.usage,
      costUsd: response.costUsd ?? 0,
      attribution
    })
  }
}

function isAttributed(attribution: UsageAttribution): boolean {
  return Boolean(attribution.primary) || (attribution.participants?.length ?? 0) > 0
}

function toSituationWithCharacters(value: unknown): SituationWithCharacters[] {
  if (!value || typeof value !== "object") {
    return []
  }

  const candidate = value as {
    readonly characters?: unknown
    readonly situation?: unknown
  }

  if (typeof candidate.situation !== "string") {
    return []
  }

  const characters = Array.isArray(candidate.characters)
    ? candidate.characters.filter((character): character is string => typeof character === "string")
    : []

  return [
    {
      situation: candidate.situation,
      characters
    }
  ]
}

function toGrammarIssue(value: unknown): GrammarIssue[] {
  if (!value || typeof value !== "object") {
    return []
  }

  const candidate = value as {
    readonly start?: unknown
    readonly end?: unknown
    readonly original?: unknown
    readonly suggestion?: unknown
    readonly reason?: unknown
  }

  if (
    typeof candidate.start !== "number" ||
    typeof candidate.end !== "number" ||
    typeof candidate.original !== "string" ||
    typeof candidate.suggestion !== "string" ||
    typeof candidate.reason !== "string"
  ) {
    return []
  }

  if (candidate.start < 0 || candidate.end < candidate.start) {
    return []
  }

  return [
    {
      start: candidate.start,
      end: candidate.end,
      original: candidate.original,
      suggestion: candidate.suggestion,
      reason: candidate.reason
    }
  ]
}
