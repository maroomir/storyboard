import {
  joinStoryPath,
  isHiddenSceneFileName,
  parseDraft,
  parseSceneFileName,
  readDraftFile,
  readSceneFile,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import type {
  Draft,
  SceneFile,
  SceneFileNameParts,
  StoryboardProjectPaths,
  StoryUri,
} from '@storyboard/story-model';

const EXCERPT_LENGTH_LIMIT: number = 800;

export async function findRecentBackgroundExcerpt(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  currentSceneStem: string,
  backgroundId: string,
): Promise<string | undefined> {
  const currentOrder: number | undefined = parseSceneFileName(`${currentSceneStem}.card`)?.order;
  if (currentOrder === undefined) {
    return undefined;
  }

  const earlierScenes: EarlierScene[] = await listEarlierScenes(fs, paths, currentOrder);

  for (const scene of earlierScenes) {
    const sceneUri: StoryUri = joinStoryPath(paths.sceneDirectory, scene.fileName);

    try {
      const sceneFile: SceneFile = await readSceneFile(sceneUri, fs, scene.fileName);
      if (sceneFile.frontmatter.location !== backgroundId) {
        continue;
      }
    } catch {
      continue;
    }

    const excerpt: string | undefined = await readDraftExcerpt(fs, paths, scene.stem);
    if (excerpt) {
      return excerpt;
    }
  }

  return undefined;
}

interface EarlierScene {
  readonly fileName: string;
  readonly stem: string;
  readonly order: number;
}

async function listEarlierScenes(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  currentOrder: number,
): Promise<EarlierScene[]> {
  const names: readonly string[] = await listDirectoryFileNames(
    fs,
    paths.sceneDirectory,
    (name) => !isHiddenSceneFileName(name),
  );

  return names
    .flatMap((name) => {
      const parts: SceneFileNameParts | undefined = parseSceneFileName(name);
      return parts && parts.order < currentOrder
        ? [{ fileName: name, stem: parts.stem, order: parts.order }]
        : [];
    })
    .sort((left, right) => right.order - left.order);
}

async function readDraftExcerpt(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  sceneStem: string,
): Promise<string | undefined> {
  const draftUri: StoryUri = joinStoryPath(paths.draftDirectory, `${sceneStem}.md`);

  try {
    const draft: Draft = parseDraft(await readDraftFile(draftUri, fs));
    return takeLeadingParagraphs(draft.body);
  } catch {
    return undefined;
  }
}

function takeLeadingParagraphs(body: string): string | undefined {
  const paragraphs: string[] = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const excerpt: string[] = [];
  let length: number = 0;

  for (const paragraph of paragraphs) {
    if (length + paragraph.length > EXCERPT_LENGTH_LIMIT && excerpt.length > 0) {
      break;
    }

    excerpt.push(paragraph);
    length += paragraph.length;

    if (length >= EXCERPT_LENGTH_LIMIT) {
      break;
    }
  }

  return excerpt.length > 0 ? excerpt.join('\n\n').slice(0, EXCERPT_LENGTH_LIMIT) : undefined;
}
