import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  parseSceneFileName,
  renderSceneCardBody,
  sceneCardSchema,
  toSceneFrontmatter,
  type SceneCard,
  type SceneFile,
} from '../scene';

export type SceneParseErrorCode =
  | 'invalid-scene-file-name'
  | 'invalid-scene-card-yaml'
  | 'invalid-scene-card-schema';

export interface SceneFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
}

export class SceneParseError extends Error {
  public constructor(
    public readonly code: SceneParseErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SceneParseError';
  }
}

export function parseScene(rawScene: string, fileName: string): SceneFile {
  const fileNameParts = parseSceneFileName(fileName);

  if (!fileNameParts) {
    throw new SceneParseError(
      'invalid-scene-file-name',
      'Scene 파일명은 `NN-slug.card` 형식이어야 합니다.',
    );
  }

  const card = parseSceneCard(rawScene);

  return {
    ...fileNameParts,
    card,
    frontmatter: toSceneFrontmatter(card),
    body: renderSceneCardBody(card),
  };
}

export function parseSceneCard(rawScene: string): SceneCard {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawScene.replace(/\r\n/g, '\n')) ?? {};
  } catch (error) {
    throw new SceneParseError(
      'invalid-scene-card-yaml',
      'Scene card YAML을 파싱할 수 없습니다.',
      error,
    );
  }

  try {
    return sceneCardSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .map((issue) => {
          const path = issue.path.join('.');
          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');
      throw new SceneParseError(
        'invalid-scene-card-schema',
        `Scene card 스키마가 올바르지 않습니다. (${details})`,
        error,
      );
    }

    throw error;
  }
}

export async function readSceneFile(
  uri: unknown,
  fileSystem: SceneFileSystem,
  fileName: string,
): Promise<SceneFile> {
  const bytes = await fileSystem.readFile(uri);
  return parseScene(new TextDecoder().decode(bytes), fileName);
}

export function serializeSceneCard(card: SceneCard): string {
  const parsedCard = sceneCardSchema.parse(card);

  return yaml.dump(normalizeSceneCardForSerialization(parsedCard), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

// NOTE: Entity 카드의 canonicalizeCardText와 같은 계약 — 정규화는 별도 명령(/doctor)이 의도적으로
// 수행하고, 내용 편집 diff에는 섞지 않는다.
export function canonicalizeSceneCardText(rawScene: string): {
  readonly text: string;
  readonly changed: boolean;
} {
  const text = serializeSceneCard(parseSceneCard(rawScene));

  return { text, changed: text !== rawScene };
}

function normalizeSceneCardForSerialization(card: SceneCard): SceneCard {
  return {
    type: card.type,
    id: card.id,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.characters === undefined ? {} : { characters: card.characters }),
    ...(card.location === undefined ? {} : { location: card.location }),
    ...(card.mood === undefined ? {} : { mood: card.mood }),
    ...(card.relationStage === undefined ? {} : { relationStage: card.relationStage }),
    ...(card.povCharacter === undefined ? {} : { povCharacter: card.povCharacter }),
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
    ...(card.grounding === undefined ? {} : { grounding: card.grounding }),
    ...(card.purpose === undefined ? {} : { purpose: card.purpose }),
    ...(card.conflict === undefined ? {} : { conflict: card.conflict }),
    ...(card.twist === undefined ? {} : { twist: card.twist }),
    ...(card.emotionalShift === undefined ? {} : { emotionalShift: card.emotionalShift }),
    ...(card.endState === undefined ? {} : { endState: card.endState }),
    ...(card.foreshadowing === undefined ? {} : { foreshadowing: card.foreshadowing }),
    ...(card.neededCanon === undefined ? {} : { neededCanon: card.neededCanon }),
    ...(card.summary === undefined ? {} : { summary: card.summary }),
  };
}
