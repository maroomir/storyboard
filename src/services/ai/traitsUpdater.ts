import type { CharacterCard } from "@/shared/card"
import { readCardFile, writeCardFile, type CardFileSystem } from "@/files/card"
import { parseBulletList } from "@/utils/aiResponseParser"
import { reconcileCharacterTraits } from "@/utils/traitsProcessor"
import type { StoryboardAIService } from "./AIService"
import type { UsageAttribution } from "./types"

export interface TraitsUpdateLogger {
  readonly error: (message: string, error?: unknown) => void
}

export interface TraitsUpdateSummary {
  readonly updatedCardCount: number
  readonly skippedUnchangedCount: number
}

export interface UpdateCharacterTraitsFromDraftInput {
  readonly sceneStem?: string
  readonly draftBody: string
  readonly detectedCharacterCards: readonly CharacterCard[]
  readonly aiService: Pick<StoryboardAIService, "extractTraitsByCharacter">
  readonly fileSystem: CardFileSystem
  readonly resolveCharacterCardUri: (card: CharacterCard) => unknown
  readonly recentDialogueLimit?: number
  readonly logger?: TraitsUpdateLogger
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function extractQuotedUtterancesForCharacter(
  script: string,
  characterName: string,
  aliases?: readonly string[]
): string[] {
  const utterances: string[] = []
  const speakerNames = [characterName, ...(aliases ?? [])]
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const speaker = new RegExp(`^\\s*(?:${speakerNames.map(escapeRegExp).join("|")})\\s*:\\s*(.+)$`)

  for (const rawLine of script.split(/\r?\n/)) {
    const match = speaker.exec(rawLine)

    if (!match) {
      continue
    }

    collectQuotedStrings(match[1] ?? "", utterances)
  }

  return utterances
}

function collectQuotedStrings(text: string, out: string[]): void {
  const quotePatterns = [/"([^"]+)"/g, /「([^」]+)」/g, /'([^']+)'/g]

  for (const pattern of quotePatterns) {
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
      const raw = (match[1] ?? "").trim()

      if (raw.length >= 2) {
        out.push(raw)
      }
    }
  }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

async function extractTraitsForCards(
  input: UpdateCharacterTraitsFromDraftInput
): Promise<Record<string, string[]> | undefined> {
  const { draftBody, detectedCharacterCards, aiService, logger } = input
  const sceneStem = input.sceneStem
  const characterIdByName = new Map(detectedCharacterCards.map((card) => [card.name, card.id]))

  try {
    return await aiService.extractTraitsByCharacter(
      draftBody,
      detectedCharacterCards.map((card) => card.name),
      sceneStem === undefined
        ? {}
        : {
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
    logger?.error("Traits extraction failed", error)

    return undefined
  }
}

async function loadExistingTraits(
  detectedCharacterCards: readonly CharacterCard[],
  readCharacterCard: (ref: CharacterCard) => ReturnType<typeof readCardFile>
): Promise<Record<string, readonly string[]>> {
  const existingTraits: Record<string, readonly string[]> = {}

  for (const ref of detectedCharacterCards) {
    try {
      const current = await readCharacterCard(ref)

      if (current.type === "character") {
        existingTraits[ref.name] = current.traits ?? []
      }
    } catch {
      existingTraits[ref.name] = ref.traits ?? []
    }
  }

  return existingTraits
}

type TraitsCardOutcome = "updated" | "skipped" | "noop"

async function applyTraitsToCard(args: {
  readonly ref: CharacterCard
  readonly processed: ReturnType<typeof reconcileCharacterTraits>
  readonly draftBody: string
  readonly limit: number
  readonly fileSystem: CardFileSystem
  readonly resolveCharacterCardUri: (card: CharacterCard) => unknown
}): Promise<TraitsCardOutcome> {
  const { ref, processed, draftBody, limit, fileSystem, resolveCharacterCardUri } = args
  const cardUri = resolveCharacterCardUri(ref)
  const current = await readCardFile(cardUri, fileSystem)

  if (current.type !== "character") {
    return "noop"
  }

  const additions = processed[current.name] ?? []
  const quoted = extractQuotedUtterancesForCharacter(draftBody, current.name)
  const mergedTraits = [...(current.traits ?? []), ...additions]
  const mergedRecent = [...(current.recentDialogues ?? []), ...quoted].slice(-limit)
  const traitsUnchanged = sameStringArray(mergedTraits, current.traits ?? [])
  const recentUnchanged = sameStringArray(mergedRecent, current.recentDialogues ?? [])

  if (traitsUnchanged && recentUnchanged) {
    return "skipped"
  }

  const next: CharacterCard = {
    ...current,
    traits: mergedTraits,
    recentDialogues: mergedRecent
  }

  await writeCardFile(cardUri, fileSystem, next)

  return "updated"
}

export async function updateCharacterTraitsFromDraft(
  input: UpdateCharacterTraitsFromDraftInput
): Promise<TraitsUpdateSummary> {
  const limit = input.recentDialogueLimit ?? 8
  const { draftBody, detectedCharacterCards, fileSystem, logger } = input

  const readCharacterCard = (ref: CharacterCard): ReturnType<typeof readCardFile> =>
    readCardFile(input.resolveCharacterCardUri(ref), fileSystem)

  if (detectedCharacterCards.length === 0) {
    return { updatedCardCount: 0, skippedUnchangedCount: 0 }
  }

  const extracted = await extractTraitsForCards(input)
  if (extracted === undefined) {
    return { updatedCardCount: 0, skippedUnchangedCount: 0 }
  }

  const existingTraits = await loadExistingTraits(detectedCharacterCards, readCharacterCard)
  const processed = reconcileCharacterTraits(extracted, existingTraits)

  let updatedCardCount = 0
  let skippedUnchangedCount = 0

  for (const ref of detectedCharacterCards) {
    try {
      const outcome = await applyTraitsToCard({
        ref,
        processed,
        draftBody,
        limit,
        fileSystem,
        resolveCharacterCardUri: input.resolveCharacterCardUri
      })

      if (outcome === "updated") {
        updatedCardCount += 1
      } else if (outcome === "skipped") {
        skippedUnchangedCount += 1
      }
    } catch (error) {
      logger?.error(`Failed to update traits for character ${ref.name}`, error)
    }
  }

  return { updatedCardCount, skippedUnchangedCount }
}

export interface ScheduleCharacterTraitsUpdateInput extends UpdateCharacterTraitsFromDraftInput {
  readonly queueKey: string
  readonly onComplete?: (summary: TraitsUpdateSummary) => void
}

const traitsUpdateQueues = new Map<string, Promise<unknown>>()

function enqueueKeyedTraitsJob(queueKey: string, task: () => Promise<TraitsUpdateSummary>): Promise<TraitsUpdateSummary> {
  const previous = traitsUpdateQueues.get(queueKey) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => task()) as Promise<TraitsUpdateSummary>
  traitsUpdateQueues.set(queueKey, next)

  return next
}

export function scheduleCharacterTraitsUpdate(input: ScheduleCharacterTraitsUpdateInput): void {
  const { queueKey, onComplete, logger, ...rest } = input

  void enqueueKeyedTraitsJob(queueKey, () => updateCharacterTraitsFromDraft(rest)).then(
    (summary) => {
      onComplete?.(summary)
    },
    (error: unknown) => {
      logger?.error("Traits background update failed", error)
    }
  )
}

export function applyTraitsFromExtractedBullets(input: {
  readonly draftBody: string
  readonly detectedCharacterCards: readonly CharacterCard[]
  readonly rawResponsesByCharacter: Readonly<Record<string, string>>
  readonly fileSystem: CardFileSystem
  readonly resolveCharacterCardUri: (card: CharacterCard) => unknown
  readonly recentDialogueLimit?: number
}): Promise<TraitsUpdateSummary> {
  const fakeService: Pick<StoryboardAIService, "extractTraitsByCharacter"> = {
    extractTraitsByCharacter: async (_draft, names) => {
      const result: Record<string, string[]> = {}

      for (const name of names) {
        const raw = input.rawResponsesByCharacter[name]

        if (raw !== undefined) {
          result[name] = parseBulletList(raw)
        }
      }

      return result
    }
  }

  return updateCharacterTraitsFromDraft({
    draftBody: input.draftBody,
    detectedCharacterCards: input.detectedCharacterCards,
    aiService: fakeService,
    fileSystem: input.fileSystem,
    resolveCharacterCardUri: input.resolveCharacterCardUri,
    recentDialogueLimit: input.recentDialogueLimit
  })
}
