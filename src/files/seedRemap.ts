import {
  renameCardIdInBackgroundCard,
  setCardId
} from "@/core/cardReferenceRewriter"
import { cardIdPattern } from "@/shared/card"
import type { DecodedSeedContent } from "@/services/seedcoat/projectAdapter"

export class SeedIdMappingConflictError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "SeedIdMappingConflictError"
  }
}

export class SeedIdMappingValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "SeedIdMappingValidationError"
  }
}

export function validateSeedIdMapping(
  seed: DecodedSeedContent,
  mapping: ReadonlyMap<string, string>
): void {
  const targetIds = new Map<string, string>()

  for (const [oldId, newId] of mapping) {
    if (oldId === newId) {
      continue
    }

    if (!cardIdPattern.test(newId)) {
      throw new SeedIdMappingValidationError(`Invalid card id: ${newId}`)
    }

    const previousOldId = targetIds.get(newId)

    if (previousOldId !== undefined && previousOldId !== oldId) {
      throw new SeedIdMappingConflictError(
        `Multiple source ids map to the same target id: ${newId}`
      )
    }

    targetIds.set(newId, oldId)
  }

  const finalIdCounts = new Map<string, number>()

  for (const card of seed.characters) {
    const finalId = mapping.get(card.id) ?? card.id
    finalIdCounts.set(finalId, (finalIdCounts.get(finalId) ?? 0) + 1)
  }

  for (const card of seed.backgrounds) {
    const finalId = mapping.get(card.id) ?? card.id
    finalIdCounts.set(finalId, (finalIdCounts.get(finalId) ?? 0) + 1)
  }

  for (const [finalId, count] of finalIdCounts) {
    if (count > 1) {
      throw new SeedIdMappingConflictError(
        `Target id ${finalId} would be used by multiple cards`
      )
    }
  }
}

export function applySeedIdMapping(
  seed: DecodedSeedContent,
  mapping: ReadonlyMap<string, string>
): DecodedSeedContent {
  if (mapping.size === 0) {
    return seed
  }

  validateSeedIdMapping(seed, mapping)

  const characters = seed.characters.map((card) => {
    const newId = mapping.get(card.id)

    return newId !== undefined && newId !== card.id ? setCardId(card, newId) : card
  })

  let backgrounds = seed.backgrounds.map((card) => {
    const newId = mapping.get(card.id)

    return newId !== undefined && newId !== card.id ? setCardId(card, newId) : card
  })

  for (const [oldId, newId] of mapping) {
    if (oldId === newId) {
      continue
    }

    backgrounds = backgrounds.map((card) => renameCardIdInBackgroundCard(card, oldId, newId))
  }

  return {
    ...seed,
    characters,
    backgrounds
  }
}
