import { joinStoryPath, type StoryUri } from '#format/storyUri';
import { posix } from 'node:path';
import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  isSceneSummaryReference,
  parseSceneFileName,
  renderSceneCardBody,
  sceneCardSchema,
  sceneSummaryReference,
  toSceneFrontmatter,
  type SceneCard,
  type SceneFile,
  type SceneFileNameParts,
} from '#format/scene';

export type SceneParseErrorCode =
  | 'invalid-scene-file-name'
  | 'invalid-scene-card-yaml'
  | 'invalid-scene-card-schema'
  | 'missing-scene-summary-file';

export interface SceneFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
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

// summaryText 는 카드 옆 summary 파일의 내용이다. 인라인 summary 는 아직 파일로 옮기지 않은
// 카드이므로 그 값을 그대로 산문으로 쓴다.
export function parseScene(rawScene: string, fileName: string, summaryText?: string): SceneFile {
  return toSceneFile(requireSceneFileNameParts(fileName), parseSceneCard(rawScene), summaryText);
}

function requireSceneFileNameParts(fileName: string): SceneFileNameParts {
  const fileNameParts = parseSceneFileName(fileName);

  if (!fileNameParts) {
    throw new SceneParseError(
      'invalid-scene-file-name',
      'Scene 파일명은 `NN-slug.card` 형식이어야 합니다.',
    );
  }

  return fileNameParts;
}

function toSceneFile(
  fileNameParts: SceneFileNameParts,
  card: SceneCard,
  summaryText: string | undefined,
): SceneFile {
  const resolvedSummary =
    summaryText ?? (isSceneSummaryReference(card.summary) ? undefined : card.summary);

  return {
    ...fileNameParts,
    card,
    frontmatter: toSceneFrontmatter(card),
    body: renderSceneCardBody(card, resolvedSummary),
    ...(resolvedSummary === undefined ? {} : { summaryText: resolvedSummary }),
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
  uri: StoryUri,
  fileSystem: SceneFileSystem,
  fileName: string,
): Promise<SceneFile> {
  const fileNameParts = requireSceneFileNameParts(fileName);
  const card = parseSceneCard(new TextDecoder().decode(await fileSystem.readFile(uri)));
  const summaryText = await readSceneSummaryText(uri, fileSystem, card);

  return toSceneFile(fileNameParts, card, summaryText);
}

export function sceneSummaryUri(sceneUri: StoryUri, summaryFileName: string): StoryUri {
  return joinStoryPath(sceneUri.with({ path: posix.dirname(sceneUri.path) }), summaryFileName);
}

async function readSceneSummaryText(
  sceneUri: StoryUri,
  fileSystem: SceneFileSystem,
  card: SceneCard,
): Promise<string | undefined> {
  const summaryFileName = sceneSummaryReference(card.summary);

  if (summaryFileName === undefined) {
    return undefined;
  }

  try {
    const bytes = await fileSystem.readFile(sceneSummaryUri(sceneUri, summaryFileName));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    throw new SceneParseError(
      'missing-scene-summary-file',
      `summary 파일 ${summaryFileName} 을 읽을 수 없습니다.`,
      error,
    );
  }
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
    ...(card.beats === undefined ? {} : { beats: card.beats }),
  };
}
