import {
  assembleManuscript,
  flattenChapterPlan,
  type AssembledManuscript,
  type ChapterSummary,
  type FlatChapterScene,
  type StoryUri,
} from '@storyboard/story-model';

import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { ManuscriptAssemblySource } from '#engine/application/manuscript/manuscriptRepositories';
import { SummarizeChaptersUseCase } from '#engine/application/manuscript/summarizeChaptersUseCase';

export interface ChapterSummaryRefresherDependencies {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
}

function sceneOrdersByChapter(source: ManuscriptAssemblySource): Map<string, number[]> {
  const orders: Map<string, number[]> = new Map();
  flattenChapterPlan(source.plan).forEach((scene: FlatChapterScene, index: number) => {
    orders.set(scene.chapterTitle, [...(orders.get(scene.chapterTitle) ?? []), index + 1]);
  });
  return orders;
}

export class ChapterSummaryRefresher {
  public constructor(private readonly dependencies: ChapterSummaryRefresherDependencies) {}

  public async listMissing(workspaceRoot: StoryUri, beforeSceneOrder?: number): Promise<string[]> {
    const { chapterSummaries } = this.dependencies.repositories;
    if (!(await chapterSummaries.hasChapterPlan(workspaceRoot))) {
      return [];
    }

    const source: ManuscriptAssemblySource = await chapterSummaries.loadAssemblySource(workspaceRoot);
    const summarized: ReadonlySet<string> = new Set(
      (await chapterSummaries.readChapterSummaries(workspaceRoot)).map(
        (summary: ChapterSummary) => summary.chapterTitle,
      ),
    );

    return [...sceneOrdersByChapter(source)].flatMap(([chapterTitle, orders]): string[] => {
      const isWritten: boolean = orders.every((order) => source.draftsByOrder.has(order));
      const isBefore: boolean =
        beforeSceneOrder === undefined || orders.every((order) => order < beforeSceneOrder);
      return !summarized.has(chapterTitle) && isWritten && isBefore ? [chapterTitle] : [];
    });
  }

  public async refreshBefore(workspaceRoot: StoryUri, sceneOrder: number): Promise<number> {
    const missing: readonly string[] = await this.listMissing(workspaceRoot, sceneOrder);
    if (missing.length === 0) {
      return 0;
    }

    const source: ManuscriptAssemblySource =
      await this.dependencies.repositories.chapterSummaries.loadAssemblySource(workspaceRoot);
    const manuscript: AssembledManuscript = assembleManuscript({
      draftsByOrder: source.draftsByOrder,
      plan: source.plan,
      projectName: source.projectName,
    });
    const { host, ai, repositories } = this.dependencies;
    const summarizer: SummarizeChaptersUseCase = new SummarizeChaptersUseCase(host, ai, repositories);

    for (const chapterTitle of missing) {
      const chapterIndex: number = manuscript.chapters.findIndex(
        (chapter) => chapter.chapterTitle === chapterTitle,
      );
      if (chapterIndex >= 0) {
        await summarizer.execute({ workspaceRoot, chapterIndex });
      }
    }

    return missing.length;
  }
}
