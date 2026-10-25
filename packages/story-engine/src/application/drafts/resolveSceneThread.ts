import {
  isHiddenSceneFileName,
  mainThreadId,
  parseSceneCard,
  parseSceneFileName,
  type SceneFile,
  type StoryboardProject,
  joinStoryPath,
  resolveThreadPaths,
  type StoryboardProjectPaths,
  type SceneFileNameParts,
  type StoryThread,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

interface NumberedSceneFile {
  readonly name: string;
  readonly order: number;
}

export interface SceneThreadContext {
  readonly threadId: string;
  readonly threadPaths: StoryboardProjectPaths;
  readonly previousSceneOrder: number | undefined;
}

export async function resolveSceneThread(
  paths: StoryboardProjectPaths,
  scene: SceneFile,
  project: StoryboardProject,
  fileSystem: IFileSystem,
  chapterThread?: string,
): Promise<SceneThreadContext> {
  if (!hasDeclaredThreads(project)) {
    return { threadId: mainThreadId, threadPaths: paths, previousSceneOrder: undefined };
  }

  const threadId: string = scene.card.thread ?? chapterThread ?? mainThreadId;

  return {
    threadId,
    threadPaths: resolveThreadPaths(paths, threadId),
    previousSceneOrder: await findPreviousSceneOrderInThread(
      paths,
      scene,
      threadId,
      chapterThread,
      fileSystem,
    ),
  };
}

function hasDeclaredThreads(project: StoryboardProject): boolean {
  const threads: Record<string, StoryThread> | undefined = project.setting?.threads;
  return threads !== undefined && Object.keys(threads).length > 0;
}

async function findPreviousSceneOrderInThread(
  paths: StoryboardProjectPaths,
  scene: SceneFile,
  threadId: string,
  chapterThread: string | undefined,
  fileSystem: IFileSystem,
): Promise<number | undefined> {
  let entries: FileSystemDirectoryEntry[];
  try {
    entries = await fileSystem.readDirectory(paths.sceneDirectory);
  } catch {
    return undefined;
  }

  const earlierScenes: NumberedSceneFile[] = entries
    .filter(([name, entry]) => entry.type === 'file' && !isHiddenSceneFileName(name))
    .flatMap(([name]) => {
      const parsed: SceneFileNameParts | undefined = parseSceneFileName(name);
      return parsed && parsed.order < scene.order
        ? [{ name, order: parsed.order } satisfies NumberedSceneFile]
        : [];
    })
    .sort((left, right) => right.order - left.order);

  for (const candidate of earlierScenes) {
    if ((await readSceneThreadId(paths, candidate.name, fileSystem, chapterThread)) === threadId) {
      return candidate.order;
    }
  }

  return undefined;
}

async function readSceneThreadId(
  paths: StoryboardProjectPaths,
  fileName: string,
  fileSystem: IFileSystem,
  chapterThread: string | undefined,
): Promise<string | undefined> {
  try {
    const bytes: Uint8Array = await fileSystem.readFile(
      joinStoryPath(paths.sceneDirectory, fileName),
    );
    return parseSceneCard(new TextDecoder().decode(bytes)).thread ?? chapterThread ?? mainThreadId;
  } catch {
    return undefined;
  }
}
