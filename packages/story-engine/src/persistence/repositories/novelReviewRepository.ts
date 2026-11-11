import {
  joinStoryPath,
  type StoryUri,
  getStoryboardProjectPaths,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
  type StoryboardProjectPaths,
  type ManuscriptDraftEntry,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  INovelReviewRepository,
  NovelReviewSource,
} from '#engine/application/novel/novelPipeline';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
import type { CardFactReader } from '#engine/persistence/bundles/cardFactReader';
export class NovelReviewRepository implements INovelReviewRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly facts: CardFactReader,
  ) {}

  public async loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const draftsByOrder: Map<number, ManuscriptDraftEntry> = await new DraftRepository(
      this.fileSystem,
    ).collectByOrder(paths, { warn: (): void => undefined });
    const canonFactLines: string[] = await this.facts.readFactLines(workspaceRoot);
    const chapterSummaries: ChapterSummary[] = await this.loadFreshChapterSummaries(
      paths.chapterSummaries,
    );

    return { draftsByOrder, canonFactLines, chapterSummaries };
  }

  public async saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    await this.fileSystem.writeFile(
      joinStoryPath(paths.manuscriptDirectory, 'REVIEW.md'),
      new TextEncoder().encode(markdown),
    );
  }

  private async loadFreshChapterSummaries(summaryUri: StoryUri): Promise<ChapterSummary[]> {
    try {
      const markdown: string = new TextDecoder().decode(await this.fileSystem.readFile(summaryUri));
      return parseChapterSummariesMarkdown(markdown).filter((chapter) => chapter.isStale !== true);
    } catch {
      return [];
    }
  }

}
