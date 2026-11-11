import {
  buildChapterSummariesMarkdown,
  flattenChapterPlan,
  getStoryboardProjectPaths,
  type ChapterPlan,
  type ChapterSummary,
  type StoryboardProject,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ChapterOutlineStore } from '#engine/persistence/bundles/chapterOutlineStore';
import {
  ChapterSummaryStore,
  type CachedChapterSummary,
} from '#engine/persistence/cache/chapterSummaryStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';

export interface ChapterSummaryLedgerDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly chapters: ChapterOutlineStore;
}

const unsealedHash: string = '';

export class ChapterSummaryLedger {
  public constructor(private readonly dependencies: ChapterSummaryLedgerDependencies) {}

  public async read(workspaceRoot: StoryUri, threadId: string): Promise<ChapterSummary[]> {
    const rows: readonly CachedChapterSummary[] = (await this.store(workspaceRoot)).listThread(threadId);
    const order: readonly string[] = await this.chapterTitles(workspaceRoot);
    const rank = (title: string): number => {
      const index: number = order.indexOf(title);
      return index === -1 ? order.length : index;
    };

    return [...rows]
      .sort((left, right) => rank(left.chapterId) - rank(right.chapterId))
      .map((row) => ({
        chapterTitle: row.chapterId,
        summary: row.summary,
        ...(row.inputHash === unsealedHash ? {} : { sourceHash: row.inputHash }),
      }));
  }

  public async write(
    workspaceRoot: StoryUri,
    threadId: string,
    summaries: readonly ChapterSummary[],
  ): Promise<void> {
    const store: ChapterSummaryStore = await this.store(workspaceRoot);
    const kept: readonly ChapterSummary[] = summaries.filter((summary) => summary.isStale !== true);
    const keptTitles: ReadonlySet<string> = new Set(kept.map((summary) => summary.chapterTitle));

    for (const row of store.listThread(threadId)) {
      if (!keptTitles.has(row.chapterId)) {
        store.remove(threadId, row.chapterId);
      }
    }

    for (const summary of kept) {
      store.save({
        threadId,
        chapterId: summary.chapterTitle,
        inputHash: summary.sourceHash ?? unsealedHash,
        summary: summary.summary,
      });
    }
  }

  public async readMarkdown(workspaceRoot: StoryUri, threadId: string): Promise<string | undefined> {
    const summaries: ChapterSummary[] = await this.read(workspaceRoot, threadId);
    if (summaries.length === 0) {
      return undefined;
    }

    return buildChapterSummariesMarkdown(await this.projectName(workspaceRoot), summaries);
  }

  private async store(workspaceRoot: StoryUri): Promise<ChapterSummaryStore> {
    return new ChapterSummaryStore(await this.dependencies.caches.open(workspaceRoot));
  }

  private async chapterTitles(workspaceRoot: StoryUri): Promise<readonly string[]> {
    try {
      const plan: ChapterPlan = await this.dependencies.chapters.load(workspaceRoot);
      return [...new Set(flattenChapterPlan(plan).map((scene) => scene.chapterTitle))];
    } catch {
      return [];
    }
  }

  private async projectName(workspaceRoot: StoryUri): Promise<string> {
    try {
      const project: StoryboardProject = await new ProjectRepository(this.dependencies.fileSystem).read(
        getStoryboardProjectPaths(workspaceRoot).projectJson,
      );
      return project.name;
    } catch {
      return '';
    }
  }
}
