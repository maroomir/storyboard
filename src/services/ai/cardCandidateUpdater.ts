import type { CharacterCard } from "@/shared/card"
import type {
  CardArcCandidate,
  CardAttributeCandidate,
  CardCandidateCharacter,
  CardRelationCandidate
} from "@/shared/cardCandidates"
import { writeCardCandidateFile, type CardCandidateFileSystem } from "@/files/cardCandidates"
import type { StoryboardAIService } from "./AIService"
import type { UsageAttribution } from "./types"

export interface CardCandidateRosterEntry {
  readonly id: string
  readonly name: string
}

export interface CardCandidateUpdateLogger {
  readonly error: (message: string, error?: unknown) => void
}

export interface CardCandidateUpdateSummary {
  readonly characterCount: number
  readonly candidateCount: number
}

export interface UpdateCardCandidatesFromDraftInput {
  readonly sceneStem: string
  readonly draftBody: string
  readonly detectedCharacterCards: readonly CharacterCard[]
  readonly characterRoster: readonly CardCandidateRosterEntry[]
  readonly aiService: Pick<StoryboardAIService, "extractCardCandidatesByCharacter">
  readonly fileSystem: CardCandidateFileSystem
  readonly resolveCandidateUri: (sceneStem: string) => unknown
  readonly ensureDirectory?: () => Promise<void>
  readonly logger?: CardCandidateUpdateLogger
}

function buildTargetResolver(
  roster: readonly CardCandidateRosterEntry[]
): (rawTarget: string) => string | undefined {
  const idByName = new Map(roster.map((entry) => [entry.name, entry.id]))
  const ids = new Set(roster.map((entry) => entry.id))

  return (rawTarget) => {
    const target = rawTarget.trim()
    if (ids.has(target)) {
      return target
    }
    return idByName.get(target)
  }
}

function dedupeRelations(relations: readonly CardRelationCandidate[]): CardRelationCandidate[] {
  const byKey = new Map<string, CardRelationCandidate>()
  for (const relation of relations) {
    byKey.set(`${relation.target}:${relation.type}`, relation)
  }
  return [...byKey.values()]
}

function dedupeAttributes(attributes: readonly CardAttributeCandidate[]): CardAttributeCandidate[] {
  const byKey = new Map<string, CardAttributeCandidate>()
  for (const attribute of attributes) {
    byKey.set(attribute.key, attribute)
  }
  return [...byKey.values()]
}

function countCandidates(character: CardCandidateCharacter): number {
  return character.attributes.length + character.relations.length + character.arc.length
}

export async function updateCardCandidatesFromDraft(
  input: UpdateCardCandidatesFromDraftInput
): Promise<CardCandidateUpdateSummary> {
  const { sceneStem, draftBody, detectedCharacterCards, characterRoster, aiService, fileSystem, logger } = input

  if (detectedCharacterCards.length === 0) {
    return { characterCount: 0, candidateCount: 0 }
  }

  let extracted: Awaited<ReturnType<StoryboardAIService["extractCardCandidatesByCharacter"]>>

  try {
    const characterIdByName = new Map(detectedCharacterCards.map((card) => [card.name, card.id]))

    extracted = await aiService.extractCardCandidatesByCharacter(
      draftBody,
      detectedCharacterCards.map((card) => card.name),
      {
        attributionForCharacter: (name: string): UsageAttribution | undefined => {
          const characterId = characterIdByName.get(name)

          if (!characterId) {
            return undefined
          }

          return {
            primary: { kind: "character" as const, id: characterId },
            participants: [{ kind: "scene" as const, id: sceneStem }]
          }
        }
      }
    )
  } catch (error) {
    logger?.error("Card candidate extraction failed", error)

    return { characterCount: 0, candidateCount: 0 }
  }

  const resolveTarget = buildTargetResolver(characterRoster)

  const characters: CardCandidateCharacter[] = []

  for (const card of detectedCharacterCards) {
    const candidate = extracted[card.name]
    if (!candidate) {
      continue
    }

    const relations = dedupeRelations(
      candidate.relations
        .map((relation) => {
          const target = resolveTarget(relation.target)
          return target && target !== card.id ? { target, type: relation.type } : undefined
        })
        .filter((relation): relation is CardRelationCandidate => relation !== undefined)
    )

    const attributes = dedupeAttributes(candidate.attributes.map((attribute) => ({ ...attribute })))

    const arc: CardArcCandidate[] = candidate.arc?.summary
      ? [{ summary: candidate.arc.summary, sceneRef: sceneStem }]
      : []

    const character: CardCandidateCharacter = { cardId: card.id, attributes, relations, arc }

    if (countCandidates(character) > 0) {
      characters.push(character)
    }
  }

  const candidateCount = characters.reduce((total, character) => total + countCandidates(character), 0)

  if (characters.length === 0) {
    return { characterCount: 0, candidateCount: 0 }
  }

  try {
    await input.ensureDirectory?.()
    await writeCardCandidateFile(input.resolveCandidateUri(sceneStem), fileSystem, {
      sceneStem,
      generatedAt: new Date().toISOString(),
      characters
    })
  } catch (error) {
    logger?.error("Failed to write card candidates", error)

    return { characterCount: 0, candidateCount: 0 }
  }

  return { characterCount: characters.length, candidateCount }
}

export interface ScheduleCardCandidateUpdateInput extends UpdateCardCandidatesFromDraftInput {
  readonly queueKey: string
  readonly onComplete?: (summary: CardCandidateUpdateSummary) => void
}

const cardCandidateQueues = new Map<string, Promise<unknown>>()

function enqueueKeyedJob(
  queueKey: string,
  task: () => Promise<CardCandidateUpdateSummary>
): Promise<CardCandidateUpdateSummary> {
  const previous = cardCandidateQueues.get(queueKey) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => task()) as Promise<CardCandidateUpdateSummary>
  cardCandidateQueues.set(queueKey, next)

  return next
}

export function scheduleCardCandidateUpdate(input: ScheduleCardCandidateUpdateInput): void {
  const { queueKey, onComplete, logger, ...rest } = input

  void enqueueKeyedJob(queueKey, () => updateCardCandidatesFromDraft({ ...rest, logger })).then(
    (summary) => {
      onComplete?.(summary)
    },
    (error: unknown) => {
      logger?.error("Card candidate background update failed", error)
    }
  )
}
