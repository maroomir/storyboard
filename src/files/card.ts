import yaml from "js-yaml"
import { ZodError } from "zod"

import {
  cardSchema,
  type BackgroundCard,
  type CharacterCard,
  type StoryboardCard
} from "../shared/card"

export type CardParseErrorCode = "invalid-yaml" | "invalid-card-schema"

export interface CardFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>
}

export class CardParseError extends Error {
  public constructor(
    public readonly code: CardParseErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "CardParseError"
  }
}

export function parseCard(rawCard: string): StoryboardCard {
  let parsedYaml: unknown

  try {
    parsedYaml = yaml.load(rawCard)
  } catch (error) {
    throw new CardParseError("invalid-yaml", "Card YAML을 파싱할 수 없습니다.", error)
  }

  try {
    return cardSchema.parse(parsedYaml)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new CardParseError("invalid-card-schema", "Card 스키마가 올바르지 않습니다.", error)
    }

    throw error
  }
}

export function serializeCard(card: StoryboardCard): string {
  const parsedCard = cardSchema.parse(card)
  const normalizedCard = normalizeCardForSerialization(parsedCard)

  return yaml.dump(normalizedCard, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false
  })
}

export async function readCardFile(uri: unknown, fileSystem: CardFileSystem): Promise<StoryboardCard> {
  const bytes = await fileSystem.readFile(uri)
  return parseCard(new TextDecoder().decode(bytes))
}

export async function writeCardFile(
  uri: unknown,
  fileSystem: CardFileSystem,
  card: StoryboardCard
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)))
}

function normalizeCardForSerialization(card: StoryboardCard): StoryboardCard {
  if (card.type === "character") {
    return normalizeCharacterCard(card)
  }

  return normalizeBackgroundCard(card)
}

function normalizeCharacterCard(card: CharacterCard): CharacterCard {
  return {
    type: card.type,
    id: card.id,
    name: card.name,
    ...(card.profile === undefined ? {} : { profile: card.profile }),
    ...(card.role === undefined ? {} : { role: card.role }),
    ...(card.attributes === undefined ? {} : { attributes: card.attributes }),
    ...(card.tags === undefined ? {} : { tags: card.tags }),
    ...(card.traits === undefined ? {} : { traits: card.traits }),
    ...(card.description === undefined ? {} : { description: card.description }),
    ...(card.voice === undefined ? {} : { voice: card.voice }),
    ...(card.relations === undefined ? {} : { relations: card.relations }),
    ...(card.arc === undefined ? {} : { arc: card.arc }),
    ...(card.recentDialogues === undefined ? {} : { recentDialogues: card.recentDialogues })
  }
}

function normalizeBackgroundCard(card: BackgroundCard): BackgroundCard {
  const base = {
    id: card.id,
    name: card.name,
    description: card.description,
    characterIds: card.characterIds,
    tags: card.tags
  }
  if (card.type === "location") {
    return { type: "location", ...base, locationKind: card.locationKind }
  }
  return { type: card.type, ...base }
}
