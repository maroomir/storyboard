import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  INovelReviewRepository,
  NovelReviewSource,
} from '#engine/application/novel/novelPipeline';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { readBibleFile } from '@storyboard/story-format';
import {
  parseChapterSummariesMarkdown,
  type ChapterSummary,
} from '#engine/domain/chapterSummaries';
export class NovelReviewRepository implements INovelReviewRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const draftsByOrder = await collectDraftsByOrder(this.fileSystem, paths, this.fileSystem, {
      warn: (): void => undefined,
    });
    const canonFactLines = await this.loadCanonFactLines(paths.bibleCanon);
    const chapterSummaries = await this.loadFreshChapterSummaries(paths.chapterSummaries);

    return { draftsByOrder, canonFactLines, chapterSummaries };
  }

  public async saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    await this.fileSystem.writeFile(
      joinStoryPath(paths.manuscriptDirectory, 'REVIEW.md'),
      new TextEncoder().encode(markdown),
    );
  }

  // 낡은 요약은 폐기된 판본의 줄거리이므로 검수 창에도 실을 수 없다.
  private async loadFreshChapterSummaries(summaryUri: StoryUri): Promise<ChapterSummary[]> {
    try {
      const markdown = new TextDecoder().decode(await this.fileSystem.readFile(summaryUri));
      return parseChapterSummariesMarkdown(markdown).filter((chapter) => chapter.isStale !== true);
    } catch {
      return [];
    }
  }

  private async loadCanonFactLines(bibleCanonUri: StoryUri): Promise<string[]> {
    try {
      const bible = await readBibleFile(bibleCanonUri, this.fileSystem);
      return bible.facts
        .filter((fact) => fact.status === 'canon')
        .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
    } catch {
      return [];
    }
  }
}
