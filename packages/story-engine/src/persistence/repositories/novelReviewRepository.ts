import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  INovelReviewRepository,
  NovelReviewSource,
} from '#engine/application/novel/novelPipeline';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { readBibleFile } from '@storyboard/story-format';
export class NovelReviewRepository implements INovelReviewRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const draftsByOrder = await collectDraftsByOrder(this.fileSystem, paths, this.fileSystem, {
      warn: (): void => undefined,
    });
    const canonFactLines = await this.loadCanonFactLines(paths.bibleCanon);

    return { draftsByOrder, canonFactLines };
  }

  public async saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    await this.fileSystem.writeFile(
      joinStoryPath(paths.manuscriptDirectory, 'REVIEW.md'),
      new TextEncoder().encode(markdown),
    );
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
