import {
  joinStoryPath,
  type StoryUri,
  readBibleFile,
  getStoryboardProjectPaths,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
  type StoryboardProjectPaths,
  type ManuscriptDraftEntry,
  type StoryBible,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  INovelReviewRepository,
  NovelReviewSource,
} from '#engine/application/novel/novelPipeline';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
export class NovelReviewRepository implements INovelReviewRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const draftsByOrder: Map<number, ManuscriptDraftEntry> = await new DraftRepository(
      this.fileSystem,
    ).collectByOrder(paths, { warn: (): void => undefined });
    const canonFactLines: string[] = await this.loadCanonFactLines(paths.bibleCanon);
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

  private async loadCanonFactLines(bibleCanonUri: StoryUri): Promise<string[]> {
    try {
      const bible: StoryBible = await readBibleFile(bibleCanonUri, this.fileSystem);
      return bible.facts
        .filter((fact) => fact.status === 'canon')
        .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
    } catch {
      return [];
    }
  }
}
