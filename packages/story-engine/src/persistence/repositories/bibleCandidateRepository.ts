import {
  type StoryUri,
  createEmptyBible,
  readBibleFile,
  writeBibleFile,
  getStoryboardProjectPaths,
  readBibleCandidateFile,
  type BibleCandidateRecord,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { readDirectoryFiles } from '#engine/persistence/directoryFiles';
import type { StoryBible } from '@storyboard/story-model';
import type { IBibleCandidateRepository } from '#engine/application/project/bibleRepositories';
export class BibleCandidateRepository implements IBibleCandidateRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadCanon(workspaceRoot: StoryUri): Promise<StoryBible> {
    const { bibleCanon } = getStoryboardProjectPaths(workspaceRoot);

    try {
      return await readBibleFile(bibleCanon, this.fileSystem);
    } catch {
      return createEmptyBible();
    }
  }

  public async loadRecords(workspaceRoot: StoryUri): Promise<readonly BibleCandidateRecord[]> {
    const { bibleCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);

    return await readDirectoryFiles(this.fileSystem, bibleCacheDirectory, {
      isEligible: (name) => name.endsWith('.json'),
      read: (uri) => readBibleCandidateFile(uri, this.fileSystem),
    });
  }

  public async saveCanon(workspaceRoot: StoryUri, canon: StoryBible): Promise<void> {
    const { bibleCanon, bibleDirectory } = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(bibleDirectory);
    await writeBibleFile(bibleCanon, this.fileSystem, canon);
  }
}
