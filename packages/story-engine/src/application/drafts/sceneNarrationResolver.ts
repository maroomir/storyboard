import { ChapterOutlineStore } from '#engine/persistence/bundles/chapterOutlineStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import {
  flattenChapterPlan,
  mainThreadId,
  resolveNarration,
  resolveThreadPaths,
} from '@storyboard/story-model';
import type {
  ChapterPlan,
  FlatChapterScene,
  NarrationDirective,
  ProjectSetting,
  SceneFile,
  StoryboardProject,
  StoryboardProjectPaths,
  StoryThread,
} from '@storyboard/story-model';
import { NarratorCardRepository } from '#engine/persistence/repositories/narratorCardRepository';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export interface ChapterNarrationDefaults {
  readonly narrator?: string;
  readonly thread?: string;
}

export interface SceneThreadContext {
  readonly threadId: string;
  readonly threadPaths: StoryboardProjectPaths;
  readonly previousSceneOrder: number | undefined;
}

function hasDeclaredThreads(project: StoryboardProject): boolean {
  const threads: Record<string, StoryThread> | undefined = project.setting?.threads;
  return threads !== undefined && Object.keys(threads).length > 0;
}

export class SceneNarrationResolver {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
    private readonly scenes: WorkspaceScenes,
    private readonly caches: WorkspaceCaches,
  ) {}

  public async readChapterDefaults(
    paths: StoryboardProjectPaths,
    sceneOrder: number,
  ): Promise<ChapterNarrationDefaults> {
    try {
      const plan: ChapterPlan = await new ChapterOutlineStore({
        fileSystem: this.fileSystem,
        scenes: this.scenes,
        caches: this.caches,
      }).load(paths.workspaceRoot);
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
      ...(referencesNarratorCard
        ? {
            narrators: await new NarratorCardRepository(this.cards).list(paths.workspaceRoot),
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
    const earlierScenes: readonly SceneFile[] = (await this.scenes.loadRoster(paths.workspaceRoot)).scenes
      .filter((candidate) => candidate.order < scene.order)
      .sort((left, right) => right.order - left.order);

    return earlierScenes.find(
      (candidate) => (candidate.card.thread ?? chapterThread ?? mainThreadId) === threadId,
    )?.order;
  }

}
