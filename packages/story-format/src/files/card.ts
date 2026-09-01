import type { StoryUri } from '#format/storyUri';
import yaml from 'js-yaml';
import { ZodError } from 'zod';

import { cardSchema, type BackgroundCard, type CharacterCard, type StoryboardCard } from '#format/card';
import { sceneCardSchema, type SceneCard } from '#format/scene';
import { serializeSceneCard } from './scene';

export type CardParseErrorCode = 'invalid-yaml' | 'invalid-card-schema';

export interface CardFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

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
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      throw new CardParseError(
        'invalid-card-schema',
        `Card 스키마가 올바르지 않습니다. (${details})`,
        error,
      );
    }

    throw error;
  }
}

export function serializeCard(card: StoryboardCard): string {
  const parsedCard = cardSchema.parse(card);
  const normalizedCard = normalizeCardForSerialization(parsedCard);

  return yaml.dump(normalizedCard, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

// `.card` 캐리어를 쓰는 모든 카드: entity 카드(character/background)와 scene 카드. 카드 에디터처럼
// 파일 하나를 종류와 무관하게 다뤄야 하는 곳만 이 유니언을 쓴다.
export type WorkspaceCard = StoryboardCard | SceneCard;

export function parseWorkspaceCard(rawCard: string): WorkspaceCard {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawCard);
  } catch (error) {
    throw new CardParseError('invalid-yaml', 'Card YAML을 파싱할 수 없습니다.', error);
  }

  const isSceneCard =
    typeof parsedYaml === 'object' &&
    parsedYaml !== null &&
    (parsedYaml as { type?: unknown }).type === 'scene';

  try {
    return isSceneCard ? sceneCardSchema.parse(parsedYaml) : cardSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      throw new CardParseError(
        'invalid-card-schema',
        `Card 스키마가 올바르지 않습니다. (${details})`,
        error,
      );
    }

    throw error;
  }
}

export function serializeWorkspaceCard(card: WorkspaceCard): string {
  return card.type === 'scene' ? serializeSceneCard(card) : serializeCard(card);
}

// Serialization is canonical (fixed key order, block sequences), but a hand-authored card may use
// inline sequences or its own key order. Without this, the first programmatic edit would fold that
// reformatting into an unrelated content diff; callers use it to normalize deliberately instead.
export function canonicalizeCardText(rawCard: string): {
  readonly text: string;
  readonly changed: boolean;
} {
  const text = serializeCard(parseCard(rawCard));

  return { text, changed: text !== rawCard };
}

export async function readCardFile(
  uri: StoryUri,
  fileSystem: CardFileSystem,
): Promise<StoryboardCard> {
  const bytes = await fileSystem.readFile(uri);
  return parseCard(new TextDecoder().decode(bytes));
}

export async function writeCardFile(
  uri: StoryUri,
  fileSystem: CardFileSystem,
  card: StoryboardCard,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeCard(card)));
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
    ...(card.desire === undefined ? {} : { desire: card.desire }),
    ...(card.relations === undefined ? {} : { relations: card.relations }),
    ...(card.arc === undefined ? {} : { arc: card.arc }),
    ...(card.recentDialogues === undefined ? {} : { recentDialogues: card.recentDialogues }),
  };
}

function normalizeBackgroundCard(card: BackgroundCard): BackgroundCard {
  const base = {
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
