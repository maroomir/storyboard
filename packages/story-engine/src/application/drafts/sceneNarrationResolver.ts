import {
  flattenChapterPlan,
  isHiddenSceneFileName,
  joinStoryPath,
  mainThreadId,
  parseSceneCard,
  parseSceneFileName,
  readChapterPlanFile,
  resolveNarration,
  resolveThreadPaths,
} from '@storyboard/story-model';
import type {
  ChapterPlan,
  FlatChapterScene,
  NarrationDirective,
  ProjectSetting,
  SceneFile,
  SceneFileNameParts,
  StoryboardProject,
  StoryboardProjectPaths,
  StoryThread,
} from '@storyboard/story-model';
import { NarratorCardRepository } from '#engine/persistence/repositories/narratorCardRepository';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

export interface ChapterNarrationDefaults {
  readonly narrator?: string;
  readonly thread?: string;
}

export interface SceneThreadContext {
  readonly threadId: string;
  readonly threadPaths: StoryboardProjectPaths;
  readonly previousSceneOrder: number | undefined;
}

interface NumberedSceneFile {
  readonly name: string;
  readonly order: number;
}

function hasDeclaredThreads(project: StoryboardProject): boolean {
  const threads: Record<string, StoryThread> | undefined = project.setting?.threads;
  return threads !== undefined && Object.keys(threads).length > 0;
}

export class SceneNarrationResolver {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async readChapterDefaults(
    paths: StoryboardProjectPaths,
    sceneOrder: number,
  ): Promise<ChapterNarrationDefaults> {
    try {
      const plan: ChapterPlan = await readChapterPlanFile(paths.outlineChapters, this.fileSystem);
      const placement: FlatChapterScene | undefined = flattenChapterPlan(plan)[sceneOrder - 1];

      return {
        ...(placement?.chapterNarrator === undefined
          ? {}
          : { narrator: placement.chapterNarrator }),
        ...(placement?.chapterThread === undefined ? {} : { thread: placement.chapterThread }),
      };
    } catch {
      return {};
    }
  }

  public async resolveNarration(
    paths: StoryboardProjectPaths,
    scene: SceneFile,
    project: StoryboardProject,
    chapterDefaults: ChapterNarrationDefaults,
  ): Promise<NarrationDirective | undefined> {
    const setting: ProjectSetting | undefined = project.setting;
    const sceneNarrator: string | undefined = scene.card.narrator;
    const defaultNarrator: string | undefined = setting?.narration?.defaultNarrator;
    const referencesNarratorCard: boolean =
      sceneNarrator !== undefined ||
      chapterDefaults.narrator !== undefined ||
      defaultNarrator !== undefined;

    return resolveNarration({
      ...(sceneNarrator === undefined ? {} : { sceneNarrator }),
      ...(chapterDefaults.narrator === undefined
        ? {}
        : { chapterNarrator: chapterDefaults.narrator }),
      ...(defaultNarrator === undefined ? {} : { defaultNarrator }),
      ...(setting?.pov === undefined ? {} : { pov: setting.pov }),
      ...(scene.frontmatter.povCharacter === undefined
        ? {}
        : { focalFallback: scene.frontmatter.povCharacter }),
      ...(referencesNarratorCard
        ? {
            narrators: await new NarratorCardRepository(this.fileSystem).list(paths.workspaceRoot),
          }
        : {}),
    });
  }

  public async resolveThread(
    paths: StoryboardProjectPaths,
    scene: SceneFile,
    project: StoryboardProject,
    chapterThread?: string,
  ): Promise<SceneThreadContext> {
    if (!hasDeclaredThreads(project)) {
      return { threadId: mainThreadId, threadPaths: paths, previousSceneOrder: undefined };
    }

    const threadId: string = scene.card.thread ?? chapterThread ?? mainThreadId;

    return {
      threadId,
      threadPaths: resolveThreadPaths(paths, threadId),
      previousSceneOrder: await this.findPreviousSceneOrderInThread(
        paths,
        scene,
        threadId,
        chapterThread,
      ),
    };
  }

  private async findPreviousSceneOrderInThread(
    paths: StoryboardProjectPaths,
    scene: SceneFile,
    threadId: string,
    chapterThread: string | undefined,
  ): Promise<number | undefined> {
    let entries: FileSystemDirectoryEntry[];
    try {
      entries = await this.fileSystem.readDirectory(paths.sceneDirectory);
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
      if ((await this.readSceneThreadId(paths, candidate.name, chapterThread)) === threadId) {
        return candidate.order;
      }
    }

    return undefined;
  }

  private async readSceneThreadId(
    paths: StoryboardProjectPaths,
    fileName: string,
    chapterThread: string | undefined,
  ): Promise<string | undefined> {
    try {
      const bytes: Uint8Array = await this.fileSystem.readFile(
        joinStoryPath(paths.sceneDirectory, fileName),
      );
      return (
        parseSceneCard(new TextDecoder().decode(bytes)).thread ?? chapterThread ?? mainThreadId
      );
    } catch {
      return undefined;
    }
  }
}
