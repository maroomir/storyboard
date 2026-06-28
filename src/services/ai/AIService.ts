import type { Background } from "@/domain/Background"
import type { Character } from "@/domain/Character"
import type { ProjectFormat } from "@/shared/project"
import type { StyleDirective } from "@/shared/styleDirective"
import { AiProviderRegistry } from "./providerRegistry"
import type {
  AiGenerateResponse,
  AiProviderId,
  AiStreamChunk,
  UsageAttribution,
  UsageRecord,
  WiredAiTaskName
} from "./types"
import { ChapterPlanPrompt } from "./prompts/chapterPlan"
import { ChapterSummaryPrompt, type ChapterSummaryInput } from "./prompts/chapterSummary"
import { ContinuityCheckPrompt } from "./prompts/continuityCheck"
import { DraftCritiquePrompt, type DraftCritiqueInput } from "./prompts/draftCritique"
import { DraftAugmentPrompt, type DraftAugmentInput } from "./prompts/draftAugment"
import { DraftRevisionPrompt, type DraftRevisionInput } from "./prompts/draftRevision"
import { OutlineSynopsisPrompt } from "./prompts/outlineSynopsis"
import { FactExtractionPrompt } from "./prompts/factExtraction"
import {
  CardCandidateExtractionPrompt,
  coerceCardCandidateExtraction,
  type CardCandidateExtraction
} from "./prompts/cardCandidateExtraction"
import { CardCandidateVerificationPrompt } from "./prompts/cardCandidateVerification"
import {
  BackgroundFactExtractionPrompt,
  coerceBackgroundFactExtraction,
  type BackgroundFactExtraction
} from "./prompts/backgroundFactExtraction"
import {
  CardRecommendationPrompt,
  coerceCardRecommendations,
  type RecommendationCategory,
  type RecommendedEntity
} from "./prompts/cardRecommendation"
import { DraftExpansionPrompt } from "./prompts/draftExpansion"
import { GenreFormattingPrompt } from "./prompts/genreFormatting"
import { GrammarCheckPrompt } from "./prompts/grammarCheck"
import { InlineCompletionPrompt } from "./prompts/inlineCompletion"
import { BackgroundDescriptionPrompt } from "./prompts/backgroundDescription"
import { PersonaDialoguePrompt } from "./prompts/personaDialogue"
import { PersonaGenerationPrompt } from "./prompts/personaGeneration"
import { SceneCoveragePrompt } from "./prompts/sceneCoverage"
import { SituationExtractionPrompt } from "./prompts/situationExtraction"
import { TraitsExtractionPrompt } from "./prompts/traitsExtraction"
import { selectPromptVariant } from "./prompts/variant"
import { type PromptArtifact, type PromptConfig, type PromptVariantId } from "./prompts/types"
import { parseBulletList, parseJsonArray, parseJsonObject } from "@/utils/aiResponseParser"
import {
  coerceChapterPlan,
  coerceOutlineSynopsis,
  type ChapterPlan,
  type OutlineBrief,
  type OutlineCharacterBrief,
  type OutlineSynopsis
} from "@/shared/outline"
import { coerceCritiqueIssues, type DraftCritiqueIssue } from "@/shared/draftReview"
import { coerceSceneCoverage, type SceneCoverageIssue } from "@/shared/sceneCoverage"
import {
  isAttributed,
  toContinuityIssue,
  toFactCandidate,
  toGrammarIssue,
  toPromptMessages,
  toSituationWithCharacters,
  type ContinuityIssue,
  type FactCandidate,
  type GrammarIssue,
  type SituationWithCharacters
} from "./aiResponseCoercion"

export type { ContinuityIssue, FactCandidate, GrammarIssue, SituationWithCharacters } from "./aiResponseCoercion"

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId
  readonly temperature?: number
  readonly maxTokens?: number
  readonly attribution?: UsageAttribution
  readonly styleDirective?: StyleDirective
}

export interface ExtractTraitsByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined
  readonly aliases?: readonly string[]
}

export interface ExtractFactsByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined
}

export interface ExtractCardCandidatesByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined
  readonly aliases?: readonly string[]
}

export interface InlineCompletionContext {
  readonly activeCharacter?: string
  readonly background?: string
  readonly sceneIntent?: string
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
    const variant = this.resolvePromptVariant("situationExtraction", options)
    const prompt = SituationExtractionPrompt.build(input, variant)
    const response = await this.generateText(
      "situationExtraction",
      toPromptMessages(prompt),
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
    const variant = this.resolvePromptVariant("personaGeneration", options)
    const prompt = PersonaGenerationPrompt.build(character, variant, options.styleDirective)
    const response = await this.generateText(
      "personaGeneration",
      toPromptMessages(prompt),
      options
    )

    return response.text.trim()
  }

  public async describeBackground(
    background: Background,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const variant = this.resolvePromptVariant("backgroundDescription", options)
    const prompt = BackgroundDescriptionPrompt.build(background, variant)
    const response = await this.generateWithDefaults(
      "backgroundDescription",
      prompt,
      BackgroundDescriptionPrompt.config,
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
    const variant = this.resolvePromptVariant("personaDialogue", options)
    const prompt = PersonaDialoguePrompt.build(
      situation,
      personas,
      background,
      previousContext,
      variant,
      options.styleDirective
    )
    const response = await this.generateText(
      "personaDialogue",
      toPromptMessages(prompt),
      options
    )

    return response.text.trim()
  }

  public async applyGenreFormat(
    dialogue: string,
    format: ProjectFormat,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const variant = this.resolvePromptVariant("sceneDraft", options)
    const prompt = GenreFormattingPrompt.build(dialogue, format, variant, options.styleDirective)
    const response = await this.generateText(
      "sceneDraft",
      toPromptMessages(prompt),
      options
    )

    return response.text.trim()
  }

  private async extractPerCharacter<T>(
    characterNames: readonly string[],
    options: GenerateTextOptions & {
      readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined
    },
    config: PromptConfig,
    runForName: (
      name: string,
      resolvedOptions: GenerateTextOptions,
      attribution: UsageAttribution | undefined
    ) => Promise<T>
  ): Promise<Record<string, T>> {
    const uniqueNames = [...new Set(characterNames.map((name) => name.trim()).filter((name) => name.length > 0))]
    const resolved = {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens
    }

    const entries = await Promise.all(
      uniqueNames.map(async (name) => {
        const attribution = resolved.attributionForCharacter?.(name) ?? resolved.attribution
        return [name, await runForName(name, resolved, attribution)] as const
      })
    )

    return Object.fromEntries(entries)
  }

  public async extractTraitsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractTraitsByCharacterOptions = {}
  ): Promise<Record<string, string[]>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      TraitsExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.resolvePromptVariant("traitsExtraction", resolvedOptions)
        const prompt = TraitsExtractionPrompt.build(draftBody, name, options.aliases, variant)
        const response = await this.generateText("traitsExtraction", toPromptMessages(prompt), {
          ...resolvedOptions,
          attribution
        })

        return parseBulletList(response.text)
      }
    )
  }

  public async extractFactsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractFactsByCharacterOptions = {}
  ): Promise<Record<string, FactCandidate[]>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      FactExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.resolvePromptVariant("factExtraction", resolvedOptions)
        const prompt = FactExtractionPrompt.build(draftBody, name, variant)
        const response = await this.generateText("factExtraction", toPromptMessages(prompt), {
          ...resolvedOptions,
          attribution
        })
        const parsedArray = parseJsonArray(response.text)

        return parsedArray ? parsedArray.flatMap((value) => toFactCandidate(value)) : []
      }
    )
  }

  public async extractCardCandidatesByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractCardCandidatesByCharacterOptions = {}
  ): Promise<Record<string, CardCandidateExtraction>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      CardCandidateExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.resolvePromptVariant("cardFactExtraction", resolvedOptions)
        const prompt = CardCandidateExtractionPrompt.build(draftBody, name, options.aliases, variant)
        const response = await this.generateText("cardFactExtraction", toPromptMessages(prompt), {
          ...resolvedOptions,
          attribution
        })

        return coerceCardCandidateExtraction(parseJsonObject(response.text))
      }
    )
  }

  public async extractBackgroundFactsFromDraft(
    draftBody: string,
    backgroundName: string,
    options: GenerateTextOptions = {}
  ): Promise<BackgroundFactExtraction> {
    const variant = this.resolvePromptVariant("backgroundFactExtraction", options)
    const prompt = BackgroundFactExtractionPrompt.build(draftBody, backgroundName, variant)
    const response = await this.generateWithDefaults(
      "backgroundFactExtraction",
      prompt,
      BackgroundFactExtractionPrompt.config,
      options
    )

    return coerceBackgroundFactExtraction(parseJsonObject(response.text))
  }

  public async extractCardRecommendations(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    options: GenerateTextOptions = {}
  ): Promise<RecommendedEntity[]> {
    const variant = this.resolvePromptVariant("cardRecommendation", options)
    const prompt = CardRecommendationPrompt.build(body, category, knownNames, variant)
    const response = await this.generateWithDefaults(
      "cardRecommendation",
      prompt,
      CardRecommendationPrompt.config,
      options
    )

    return coerceCardRecommendations(parseJsonArray(response.text), category)
  }

  public async verifyCardCandidatesByCharacter(
    draftBody: string,
    characterName: string,
    statements: readonly string[],
    options: GenerateTextOptions = {}
  ): Promise<number[] | null> {
    if (statements.length === 0) {
      return []
    }

    const variant = this.resolvePromptVariant("cardFactVerification", options)
    const prompt = CardCandidateVerificationPrompt.build(draftBody, characterName, statements, variant)
    const response = await this.generateWithDefaults(
      "cardFactVerification",
      prompt,
      CardCandidateVerificationPrompt.config,
      options
    )
    const parsedArray = parseJsonArray(response.text)

    if (!parsedArray) {
      return null
    }

    const approved = new Set<number>()

    for (const value of parsedArray) {
      const index = typeof value === "number" ? value : Number(value)
      if (Number.isInteger(index) && index >= 0 && index < statements.length) {
        approved.add(index)
      }
    }

    return [...approved]
  }

  public async checkGrammar(body: string, options: GenerateTextOptions = {}): Promise<GrammarIssue[]> {
    const variant = this.resolvePromptVariant("grammarCheck", options)
    const prompt = GrammarCheckPrompt.build(body, variant)
    const response = await this.generateWithDefaults("grammarCheck", prompt, GrammarCheckPrompt.config, options)
    const parsedArray = parseJsonArray(response.text)

    if (!parsedArray) {
      return []
    }

    return parsedArray.flatMap((value) => toGrammarIssue(value))
  }

  public async checkContinuity(
    body: string,
    facts: readonly string[],
    options: GenerateTextOptions = {}
  ): Promise<ContinuityIssue[]> {
    if (facts.length === 0) {
      return []
    }

    const variant = this.resolvePromptVariant("continuityCheck", options)
    const prompt = ContinuityCheckPrompt.build(body, facts, variant)
    const response = await this.generateWithDefaults("continuityCheck", prompt, ContinuityCheckPrompt.config, options)
    const parsedArray = parseJsonArray(response.text)

    if (!parsedArray) {
      return []
    }

    return parsedArray.flatMap((value) => toContinuityIssue(value))
  }

  public async checkSceneCoverage(
    beats: readonly string[],
    draft: string,
    options: GenerateTextOptions = {}
  ): Promise<SceneCoverageIssue[]> {
    if (beats.length === 0) {
      return []
    }

    const variant = this.resolvePromptVariant("sceneCoverage", options)
    const prompt = SceneCoveragePrompt.build(beats, draft, variant)
    const response = await this.generateWithDefaults("sceneCoverage", prompt, SceneCoveragePrompt.config, options)

    return coerceSceneCoverage(response.text, beats.length)
  }

  public async completeInline(
    prefix: string,
    context: InlineCompletionContext = {},
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const variant = this.resolvePromptVariant("inlineCompletion", options)
    const prompt = InlineCompletionPrompt.build(prefix, context, variant)
    const response = await this.generateWithDefaults("inlineCompletion", prompt, InlineCompletionPrompt.config, options)

    return response.text.trim()
  }

  public async expandDraft(
    selection: string,
    context: DraftExpansionContext = {},
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const variant = this.resolvePromptVariant("draftExpansion", options)
    const prompt = DraftExpansionPrompt.build(selection, context, variant)
    const response = await this.generateWithDefaults("draftExpansion", prompt, DraftExpansionPrompt.config, options)

    return response.text.trim()
  }

  public async generateOutlineSynopsis(
    brief: OutlineBrief,
    options: GenerateTextOptions = {}
  ): Promise<OutlineSynopsis> {
    const variant = this.resolvePromptVariant("outlineSynopsis", options)
    const prompt = OutlineSynopsisPrompt.build(brief, variant)
    const response = await this.generateWithDefaults("outlineSynopsis", prompt, OutlineSynopsisPrompt.config, options)

    return coerceOutlineSynopsis(parseJsonObject(response.text), brief)
  }

  public async generateChapterPlan(
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    characters: readonly OutlineCharacterBrief[],
    options: GenerateTextOptions = {}
  ): Promise<ChapterPlan> {
    const variant = this.resolvePromptVariant("chapterPlan", options)
    const prompt = ChapterPlanPrompt.build(brief, synopsis, characters, variant)
    const response = await this.generateWithDefaults("chapterPlan", prompt, ChapterPlanPrompt.config, options)

    return coerceChapterPlan(parseJsonObject(response.text))
  }

  public async critiqueDraft(
    input: DraftCritiqueInput,
    options: GenerateTextOptions = {}
  ): Promise<DraftCritiqueIssue[]> {
    const variant = this.resolvePromptVariant("draftCritique", options)
    const prompt = DraftCritiquePrompt.build(input, variant)
    const response = await this.generateWithDefaults("draftCritique", prompt, DraftCritiquePrompt.config, options)

    return coerceCritiqueIssues(response.text)
  }

  public async summarizeChapter(
    input: ChapterSummaryInput,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const variant = this.resolvePromptVariant("chapterSummary", options)
    const prompt = ChapterSummaryPrompt.build(input, variant)
    const response = await this.generateWithDefaults("chapterSummary", prompt, ChapterSummaryPrompt.config, options)

    return response.text.trim()
  }

  public async reviseDraft(input: DraftRevisionInput, options: GenerateTextOptions = {}): Promise<string> {
    const variant = this.resolvePromptVariant("draftRevision", options)
    const prompt = DraftRevisionPrompt.build(input, variant)
    const response = await this.generateWithDefaults("draftRevision", prompt, DraftRevisionPrompt.config, options)

    return response.text.trim()
  }

  public async augmentDraft(input: DraftAugmentInput, options: GenerateTextOptions = {}): Promise<string> {
    const variant = this.resolvePromptVariant("draftAugment", options)
    const prompt = DraftAugmentPrompt.build(input, variant)
    const response = await this.generateWithDefaults("draftAugment", prompt, DraftAugmentPrompt.config, options)

    return response.text.trim()
  }

  private async generateWithDefaults(
    taskName: WiredAiTaskName,
    prompt: PromptArtifact,
    config: PromptConfig,
    options: GenerateTextOptions
  ): Promise<AiGenerateResponse> {
    return this.generateText(taskName, toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens
    })
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

  public async *generateTextStream(
    taskName: WiredAiTaskName,
    messages: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>,
    options: GenerateTextOptions
  ): AsyncIterable<AiStreamChunk> {
    const stream = options.providerId
      ? this.registry.generateStreamWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        })
      : this.registry.generateStream({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens
        })

    for await (const chunk of stream) {
      if (chunk.type === "done") {
        this.emitUsageIfNeeded(taskName, chunk.response, options.attribution)
      }
      yield chunk
    }
  }

  private resolvePromptVariant(taskName: WiredAiTaskName, options: GenerateTextOptions): PromptVariantId {
    const resolved = this.registry.getTaskAiConfig(taskName)
    return selectPromptVariant({
      providerId: options.providerId ?? resolved.providerId,
      taskName,
      model: resolved.model,
      maxTokens: options.maxTokens
    })
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
