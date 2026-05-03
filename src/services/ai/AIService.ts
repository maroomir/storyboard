import type { Background } from "../../domain/Background"
import type { Character } from "../../domain/Character"
import type { ProjectFormat } from "../../shared/project"
import { AiProviderRegistry } from "./providerRegistry"
import type { AiGenerateResponse, AiProviderId } from "./types"
import { GenreFormattingPrompt } from "./prompts/genreFormatting"
import { PersonaDialoguePrompt } from "./prompts/personaDialogue"
import { PersonaGenerationPrompt } from "./prompts/personaGeneration"
import { SituationExtractionPrompt } from "./prompts/situationExtraction"
import { TraitsExtractionPrompt } from "./prompts/traitsExtraction"
import { parseBulletList, parseJsonArray } from "../../utils/aiResponseParser"

export interface SituationWithCharacters {
  readonly characters: readonly string[]
  readonly situation: string
}

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId
  readonly temperature?: number
  readonly maxTokens?: number
}

export class StoryboardAIService {
  public constructor(private readonly registry: AiProviderRegistry) {}

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
      "personaDialogue",
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
    options: GenerateTextOptions = {}
  ): Promise<Record<string, string[]>> {
    const uniqueNames = [...new Set(characterNames.map((name) => name.trim()).filter((name) => name.length > 0))]
    const traitOptions: GenerateTextOptions = {
      ...options,
      temperature: options.temperature ?? TraitsExtractionPrompt.config.temperature,
      maxTokens: options.maxTokens ?? TraitsExtractionPrompt.config.maxTokens
    }

    const entries = await Promise.all(
      uniqueNames.map(async (name) => {
        const response = await this.generateText(
          "traitsExtraction",
          [{ role: "user", content: TraitsExtractionPrompt.build(draftBody, name) }],
          traitOptions
        )

        return [name, parseBulletList(response.text)] as const
      })
    )

    return Object.fromEntries(entries)
  }

  private async generateText(
    taskName: "situationExtraction" | "personaDialogue" | "sceneDraft" | "traitsExtraction",
    messages: ReadonlyArray<{ readonly role: "system" | "user" | "assistant"; readonly content: string }>,
    options: GenerateTextOptions
  ): Promise<AiGenerateResponse> {
    if (options.providerId) {
      return this.registry.generateWithProvider(options.providerId, {
        taskName,
        messages,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      })
    }

    return this.registry.generate({
      taskName,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    })
  }
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
