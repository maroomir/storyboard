import type { StoryUri } from '#model/format/storyUri';
import yaml from 'js-yaml';
import { ZodError } from 'zod';

import { cardSchema, type BackgroundCard, type CharacterCard, type StoryboardCard } from '#model/format/card';
import { narratorCardSchema, type NarratorCard } from '#model/format/narrator';
import { sceneCardSchema, type SceneCard } from '#model/format/scene';
import { serializeSceneCard } from '#model/format/files/scene';
import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';

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

export function serializeCard(card: StoryboardCard): string {
  const parsedCard: StoryboardCard = cardSchema.parse(card);
  const normalizedCard: StoryboardCard = normalizeCardForSerialization(parsedCard);

  return yaml.dump(normalizedCard, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
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

export function serializeNarratorCard(card: NarratorCard): string {
  const parsedCard: NarratorCard = narratorCardSchema.parse(card);

  return yaml.dump(normalizeNarratorCard(parsedCard), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

export async function readNarratorCardFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<NarratorCard> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseNarratorCard(new TextDecoder().decode(bytes));
}

export async function writeNarratorCardFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  card: NarratorCard,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));
}

export type WorkspaceCard = StoryboardCard | SceneCard | NarratorCard;

export function parseWorkspaceCard(rawCard: string): WorkspaceCard {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawCard);
  } catch (error) {
    throw new CardParseError('invalid-yaml', 'Card YAML을 파싱할 수 없습니다.', error);
  }

  const cardType: unknown =
    typeof parsedYaml === 'object' && parsedYaml !== null
      ? (parsedYaml as { type?: unknown }).type
      : undefined;

  try {
    if (cardType === 'scene') {
      return sceneCardSchema.parse(parsedYaml);
    }
    if (cardType === 'narrator') {
      return narratorCardSchema.parse(parsedYaml);
    }
    return cardSchema.parse(parsedYaml);
  } catch (error) {
    throw toCardSchemaError(error);
  }
}

export function serializeWorkspaceCard(card: WorkspaceCard): string {
  if (card.type === 'scene') {
    return serializeSceneCard(card);
  }
  if (card.type === 'narrator') {
    return serializeNarratorCard(card);
  }
  return serializeCard(card);
}

export function canonicalizeNarratorCardText(rawCard: string): {
  readonly text: string;
  readonly changed: boolean;
} {
  const text: string = serializeNarratorCard(parseNarratorCard(rawCard));

  return { text, changed: text !== rawCard };
}

export function canonicalizeCardText(rawCard: string): {
  readonly text: string;
  readonly changed: boolean;
} {
  const text: string = serializeCard(parseCard(rawCard));

  return { text, changed: text !== rawCard };
}

export async function readCardFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<StoryboardCard> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseCard(new TextDecoder().decode(bytes));
}

export async function writeCardFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  card: StoryboardCard,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)));
}

function normalizeNarratorCard(card: NarratorCard): NarratorCard {
  return {
    type: card.type,
    id: card.id,
    name: card.name,
    person: card.person,
    knowledge: card.knowledge,
    ...(card.tense === undefined ? {} : { tense: card.tense }),
    ...(card.focal === undefined ? {} : { focal: card.focal }),
    ...(card.voice === undefined ? {} : { voice: card.voice }),
  };
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
    ...(card.tags === undefined ? {} : { tags: card.tags }),
    ...(card.traits === undefined ? {} : { traits: card.traits }),
    ...(card.description === undefined ? {} : { description: card.description }),
    ...(card.voice === undefined ? {} : { voice: card.voice }),
    ...(card.catchphrases === undefined ? {} : { catchphrases: card.catchphrases }),
    ...(card.desire === undefined ? {} : { desire: card.desire }),
    ...(card.relations === undefined ? {} : { relations: card.relations }),
    ...(card.arc === undefined ? {} : { arc: card.arc }),
    ...(card.recentDialogues === undefined ? {} : { recentDialogues: card.recentDialogues }),
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
  };
  if (card.type === 'location') {
    return { type: 'location', ...base, locationKind: card.locationKind };
  }
  return { type: card.type, ...base };
}
