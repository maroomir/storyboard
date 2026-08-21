import yaml from 'js-yaml';
import { ZodError } from 'zod';

import {
  parseSceneFileName,
  sceneFrontmatterSchema,
  type SceneFile,
  type SceneFrontmatter,
} from '../scene';

export type SceneParseErrorCode =
  | 'invalid-scene-file-name'
  | 'invalid-frontmatter-yaml'
  | 'invalid-frontmatter-schema';

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
      'Scene 파일명은 `NN-slug.txt` 형식이어야 합니다.',
    );
  }

  const parsedContent = parseSceneContent(rawScene);

  return {
    ...fileNameParts,
    frontmatter: parsedContent.frontmatter,
    body: parsedContent.body,
  };
}

export async function readSceneFile(
  uri: unknown,
  fileSystem: SceneFileSystem,
  fileName: string,
): Promise<SceneFile> {
  const bytes = await fileSystem.readFile(uri);
  return parseScene(new TextDecoder().decode(bytes), fileName);
}

function parseSceneContent(rawScene: string): {
  readonly frontmatter: SceneFrontmatter;
  readonly body: string;
} {
  const normalizedScene = rawScene.replace(/\r\n/g, '\n');

  if (!normalizedScene.startsWith('---\n')) {
    return {
      frontmatter: {},
      body: normalizedScene,
    };
  }

  const closingFenceIndex = normalizedScene.indexOf('\n---', '---\n'.length);

  if (closingFenceIndex === -1) {
    return {
      frontmatter: {},
      body: normalizedScene,
    };
  }

  const rawFrontmatter = normalizedScene.slice('---\n'.length, closingFenceIndex);
  const bodyStartIndex = closingFenceIndex + '\n---'.length;
  const body = normalizedScene.slice(bodyStartIndex).replace(/^\n/, '');

  return {
    frontmatter: parseSceneFrontmatter(rawFrontmatter),
    body,
  };
}

function parseSceneFrontmatter(rawFrontmatter: string): SceneFrontmatter {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawFrontmatter) ?? {};
  } catch (error) {
    throw new SceneParseError(
      'invalid-frontmatter-yaml',
      'Scene frontmatter YAML을 파싱할 수 없습니다.',
      error,
    );
  }

  try {
    return sceneFrontmatterSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new SceneParseError(
        'invalid-frontmatter-schema',
        'Scene frontmatter 스키마가 올바르지 않습니다.',
        error,
      );
    }

    throw error;
  }
}

