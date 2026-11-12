import yaml from 'js-yaml';
import { ZodError } from 'zod';

import { cardSchema, type BackgroundCard, type CharacterCard, type StoryboardCard } from '#model/format/card';
import { narratorCardSchema, type NarratorCard } from '#model/format/narrator';

export type CardParseErrorCode = 'invalid-yaml' | 'invalid-card-schema';

export class CardParseError extends Error {
  public constructor(
    public readonly code: CardParseErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CardParseError';
  }
}

function toCardSchemaError(error: unknown): unknown {
  if (!(error instanceof ZodError)) {
    return error;
  }

  const details: string = error.issues
    .map((issue) => {
      const path: string = issue.path.join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');

  return new CardParseError(
    'invalid-card-schema',
    `Card 스키마가 올바르지 않습니다. (${details})`,
    error,
  );
}

export function parseCard(rawCard: string): StoryboardCard {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawCard);
  } catch (error) {
    throw new CardParseError('invalid-yaml', 'Card YAML을 파싱할 수 없습니다.', error);
  }

  try {
    return cardSchema.parse(parsedYaml);
  } catch (error) {
    throw toCardSchemaError(error);
  }
}

export interface SerializeCardOptions {
  readonly keyOrderOf?: string;
}

export function serializeCard(card: StoryboardCard, options: SerializeCardOptions = {}): string {
  const parsedCard: StoryboardCard = cardSchema.parse(card);
  const normalizedCard: StoryboardCard = normalizeCardForSerialization(parsedCard);
  const orderedCard: StoryboardCard =
    options.keyOrderOf === undefined
      ? normalizedCard
      : withTopLevelKeyOrderOf(normalizedCard, options.keyOrderOf);

  return yaml.dump(orderedCard, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

function withTopLevelKeyOrderOf(card: StoryboardCard, existingCardText: string): StoryboardCard {
  const cardEntries: Record<string, unknown> = { ...card };
  const reordered: Record<string, unknown> = {};

  for (const key of topLevelKeysOf(existingCardText)) {
    if (key in cardEntries) {
      reordered[key] = cardEntries[key];
    }
  }
  for (const [key, value] of Object.entries(cardEntries)) {
    if (!(key in reordered)) {
      reordered[key] = value;
    }
  }

  return reordered as unknown as StoryboardCard;
}

function topLevelKeysOf(cardText: string): readonly string[] {
  const loaded: unknown = yaml.load(cardText);
  const isMapping: boolean = typeof loaded === 'object' && loaded !== null && !Array.isArray(loaded);

  return isMapping ? Object.keys(loaded as Record<string, unknown>) : [];
}

export function parseNarratorCard(rawCard: string): NarratorCard {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawCard);
  } catch (error) {
    throw new CardParseError('invalid-yaml', 'Card YAML을 파싱할 수 없습니다.', error);
  }

  try {
    return narratorCardSchema.parse(parsedYaml);
  } catch (error) {
    throw toCardSchemaError(error);
  }
}

function normalizeCardForSerialization(card: StoryboardCard): StoryboardCard {
  if (card.type === 'character') {
    return normalizeCharacterCard(card);
  }
  return normalizeBackgroundCard(card);
}

function normalizeCharacterCard(card: CharacterCard): CharacterCard {
  return {
    type: card.type,
    id: card.id,
    name: card.name,
    ...(card.profile === undefined ? {} : { profile: card.profile }),
    ...(card.role === undefined ? {} : { role: card.role }),
    ...(card.attributes === undefined ? {} : { attributes: card.attributes }),
    ...(card.aliases === undefined ? {} : { aliases: card.aliases }),
    ...(card.traits === undefined ? {} : { traits: card.traits }),
    ...(card.description === undefined ? {} : { description: card.description }),
    ...(card.voice === undefined ? {} : { voice: card.voice }),
    ...(card.catchphrases === undefined ? {} : { catchphrases: card.catchphrases }),
    ...(card.desire === undefined ? {} : { desire: card.desire }),
    ...(card.relations === undefined ? {} : { relations: card.relations }),
    ...(card.arc === undefined ? {} : { arc: card.arc }),
  };
}

function normalizeBackgroundCard(card: BackgroundCard): BackgroundCard {
  const base: Omit<BackgroundCard, 'type'> = {
    id: card.id,
    name: card.name,
    ...(card.aliases === undefined ? {} : { aliases: card.aliases }),
    description: card.description,
    characterIds: card.characterIds,
    tags: card.tags,
    ...(card.time === undefined ? {} : { time: card.time }),
    ...(card.weather === undefined ? {} : { weather: card.weather }),
    ...(card.senses === undefined ? {} : { senses: card.senses }),
    ...(card.layout === undefined ? {} : { layout: card.layout }),
    ...(card.rules === undefined ? {} : { rules: card.rules }),
  };
  return { type: 'location', ...base };
}
