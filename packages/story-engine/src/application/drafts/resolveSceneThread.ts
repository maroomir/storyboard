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
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface SceneThreadContext {
  readonly threadId: string;
  // 이야기 상태·요약·인물 기억이 이 줄기 안에서만 이어지도록 갈아 끼운 경로.
  readonly threadPaths: StoryboardProjectPaths;
  // 같은 줄기의 직전 씬. 줄기가 하나뿐인 작품에서는 undefined로 두어 종전 동작(바로 앞 번호)을 쓴다.
  readonly previousSceneOrder: number | undefined;
}

// NOTE: 줄기를 선언하지 않은 작품은 씬 디렉터리를 훑지 않는다. 씬마다 다른 카드를 읽는 비용은
// 옴니버스처럼 실제로 줄기가 갈린 작품만 치르면 된다.
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

  const threadId = scene.card.thread ?? chapterThread ?? mainThreadId;

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
  const threads = project.setting?.threads;
  return threads !== undefined && Object.keys(threads).length > 0;
}

async function findPreviousSceneOrderInThread(
  paths: StoryboardProjectPaths,
  scene: SceneFile,
  threadId: string,
  chapterThread: string | undefined,
  fileSystem: IFileSystem,
): Promise<number | undefined> {
  let entries;
  try {
    entries = await fileSystem.readDirectory(paths.sceneDirectory);
  } catch {
    return undefined;
  }

  const earlierScenes = entries
    .filter(([name, entry]) => entry.type === 'file' && !isHiddenSceneFileName(name))
    .flatMap(([name]) => {
      const parsed = parseSceneFileName(name);
      return parsed && parsed.order < scene.order ? [{ name, order: parsed.order }] : [];
    })
    .sort((left, right) => right.order - left.order);

  for (const candidate of earlierScenes) {
    if ((await readSceneThreadId(paths, candidate.name, fileSystem, chapterThread)) === threadId) {
      return candidate.order;
    }
  }

  return undefined;
}

// NOTE: 앞 씬의 줄기도 씬 카드가 먼저다. 카드에 없으면 이 씬과 같은 장 기본값을 쓴다 — 장이
// 다르면 그 장의 값을 읽어야 정확하지만, 시드가 카드로 복사해 두므로 실제로는 거의 걸리지 않는다.
async function readSceneThreadId(
  paths: StoryboardProjectPaths,
  fileName: string,
  fileSystem: IFileSystem,
  chapterThread: string | undefined,
): Promise<string | undefined> {
  try {
    const bytes = await fileSystem.readFile(joinStoryPath(paths.sceneDirectory, fileName));
    return parseSceneCard(new TextDecoder().decode(bytes)).thread ?? chapterThread ?? mainThreadId;
  } catch {
    return undefined;
  }
}
