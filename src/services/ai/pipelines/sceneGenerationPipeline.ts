import type { SceneContext } from "@/core/sceneContext"
import { createEmptyBackground } from "@/domain/Background"
import type { CharacterCard } from "@/shared/card"
import type { ProjectFormat } from "@/shared/project"
import type { StyleDirective } from "@/shared/styleDirective"
import type { GenerateTextOptions, SituationWithCharacters, StoryboardAIService } from "../AIService"
import type { AiProviderId, EntityRef } from "../types"

export type SceneGenerationPipelineAiService = Pick<
  StoryboardAIService,
  "extractSituations" | "createCharacterPersona" | "generatePersonaDialogue" | "applyGenreFormat"
>

export type SceneGenerationPipelineStage =
  | "extractSituations"
  | "buildPersonas"
  | "generateDialogue"
  | "applyFormat"

export interface SceneGenerationPipelineTaskProviders {
  readonly situationExtraction?: AiProviderId
  readonly personaGeneration?: AiProviderId
  readonly personaDialogue?: AiProviderId
  readonly sceneDraft?: AiProviderId
}

export class SceneGenerationPipelineCancelledError extends Error {
  public constructor() {
    super("씬 초안 생성이 취소되었습니다.")
    this.name = "SceneGenerationPipelineCancelledError"
  }
}

export interface RunSceneGenerationPipelineInput {
  readonly context: SceneContext
  readonly aiService: SceneGenerationPipelineAiService
  readonly format: ProjectFormat
  readonly styleDirective?: StyleDirective
  readonly previousContext?: string
  readonly providers?: Readonly<SceneGenerationPipelineTaskProviders>
  readonly onProgress?: (stage: SceneGenerationPipelineStage, current: number, total: number) => void
  readonly shouldCancel?: () => boolean
  readonly sceneStem?: string
  readonly backgroundId?: string
  readonly useContextCondense?: boolean
}

export interface RunSceneGenerationPipelineResult {
  readonly draftBody: string
  readonly detectedCharacters: readonly string[]
  readonly situations: readonly SituationWithCharacters[]
  readonly personasUsed: ReadonlyMap<string, string>
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>
}

export function dedupeSituations(items: readonly SituationWithCharacters[]): SituationWithCharacters[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = (item.situation || "").replace(/\s+/g, " ").trim().toLowerCase()
    if (!key) {
      return false
    }
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function buildGenerateOptions(
  providers: Readonly<SceneGenerationPipelineTaskProviders> | undefined,
  task: keyof SceneGenerationPipelineTaskProviders
): GenerateTextOptions | undefined {
  const providerId = providers?.[task]
  return providerId ? { providerId } : undefined
}

function withAttribution(
  options: GenerateTextOptions | undefined,
  attribution: GenerateTextOptions["attribution"]
): GenerateTextOptions {
  return { ...options, attribution }
}

function situationCharacterRefs(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[]
): EntityRef[] {
  const byName = new Map(characters.map((character) => [character.name, character] as const))
  const refs: EntityRef[] = []

  for (const name of situation.characters) {
    const card = byName.get(name)

    if (card) {
      refs.push({ kind: "character", id: card.id })
    }
  }

  return refs
}

function dedupeEntityRefs(refs: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  const out: EntityRef[] = []

  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(ref)
  }

  return out
}

function dialogueParticipantsForSituation(
  situation: SituationWithCharacters,
  characters: readonly CharacterCard[],
  backgroundParticipantId: string | undefined
): EntityRef[] {
  const fromSituation = situationCharacterRefs(situation, characters)
  const characterParticipants =
    fromSituation.length === 0 ? characters.map((card) => ({ kind: "character" as const, id: card.id })) : fromSituation

  const refs: EntityRef[] = [...characterParticipants]

  if (backgroundParticipantId) {
    refs.push({ kind: "background", id: backgroundParticipantId })
  }

  return dedupeEntityRefs(refs)
}

function assertNotCancelled(shouldCancel: (() => boolean) | undefined): void {
  if (shouldCancel?.()) {
    throw new SceneGenerationPipelineCancelledError()
  }
}

function condensePreviousContext(previousContext: string | undefined, enabled: boolean): string | undefined {
  if (!previousContext) {
    return undefined
  }

  if (!enabled) {
    return previousContext
  }

  const maxLength = 1200
  if (previousContext.length <= maxLength) {
    return previousContext
  }

  const lines = previousContext
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.includes(":") || /행동|표정|감정|생각|묘사/.test(line))

  if (lines.length === 0) {
    return previousContext.slice(-maxLength)
  }

  const condensed = lines.join("\n")
  return condensed.length <= maxLength ? condensed : condensed.slice(-maxLength)
}

export async function runSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput
): Promise<RunSceneGenerationPipelineResult> {
  const { context, aiService, format, styleDirective, previousContext, providers = {}, onProgress, shouldCancel } = input
  const condensedPreviousContext = condensePreviousContext(previousContext, input.useContextCondense === true)
  const sceneStem = input.sceneStem ?? input.context.scene.stem
  const sceneRef: EntityRef = { kind: "scene", id: sceneStem }
  const body = context.scene.body.trim()

  if (body.length === 0) {
    throw new Error("씬 본문이 비어 있습니다. scene 파일에 장면 설명을 작성한 뒤 다시 시도해주세요.")
  }

  const detectedCharacters = context.characters.map((character) => character.name)
  if (detectedCharacters.length === 0) {
    throw new Error("등장인물을 찾을 수 없습니다. 스크립트에 인물 이름을 포함하거나 frontmatter에 characters를 지정해주세요.")
  }

  const situationsRaw = await aiService.extractSituations(
    body,
    withAttribution(buildGenerateOptions(providers, "situationExtraction"), { primary: sceneRef })
  )
  onProgress?.("extractSituations", 1, 1)
  assertNotCancelled(shouldCancel)

  const situations = dedupeSituations(situationsRaw)
  if (situations.length === 0) {
    throw new Error("상황을 추출할 수 없습니다.")
  }

  const personaOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, "personaGeneration"),
    styleDirective
  }
  const personasUsed = new Map<string, string>()
  const characterCount = context.characters.length

  for (let i = 0; i < context.characters.length; i++) {
    const character = context.characters[i]
    if (!character) {
      continue
    }
    const persona = await aiService.createCharacterPersona(
      character,
      withAttribution(personaOptions, {
        primary: { kind: "character", id: character.id },
        participants: [sceneRef]
      })
    )
    personasUsed.set(character.name, persona)
    onProgress?.("buildPersonas", i + 1, characterCount)
    assertNotCancelled(shouldCancel)
  }

  const background = context.background ?? createEmptyBackground("scene-default", "미정")
  const dialoguePieces: string[] = []
  const dialogueOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, "personaDialogue"),
    styleDirective
  }
  const backgroundParticipantId = context.background?.id ?? input.backgroundId

  for (let i = 0; i < situations.length; i++) {
    const situation = situations[i]
    if (!situation) {
      continue
    }
    onProgress?.("generateDialogue", i + 1, situations.length)

    const prior: string | undefined = i > 0 ? situations[i - 1]?.situation : condensedPreviousContext

    const dialogueParticipants = dialogueParticipantsForSituation(situation, context.characters, backgroundParticipantId)

    const dialogue = await aiService.generatePersonaDialogue(
      situation.situation,
      personasUsed,
      background,
      prior,
      withAttribution(dialogueOptions, {
        primary: sceneRef,
        participants: dialogueParticipants
      })
    )
    dialoguePieces.push(dialogue)
    assertNotCancelled(shouldCancel)
  }

  const joinedDialogue = dialoguePieces.join("\n\n")
  onProgress?.("applyFormat", 1, 1)
  assertNotCancelled(shouldCancel)

  const draftBody = await aiService.applyGenreFormat(
    joinedDialogue,
    format,
    withAttribution({ ...buildGenerateOptions(providers, "sceneDraft"), styleDirective }, { primary: sceneRef })
  )

  return {
    draftBody,
    detectedCharacters,
    situations,
    personasUsed,
    providers
  }
}
