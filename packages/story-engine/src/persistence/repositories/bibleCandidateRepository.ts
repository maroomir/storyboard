import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { IBibleCandidateRepository } from '#engine/application/project/promoteBibleCandidatesUseCase';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { createEmptyBible, readBibleFile, writeBibleFile } from '@storyboard/story-format';
import type { StoryBible } from '@storyboard/story-format';
import {
  readBibleCandidateFile,
  type BibleCandidateRecord,
} from '#engine/domain/files/bibleCandidates';
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
    let entries: FileSystemDirectoryEntry[];

    try {
      entries = await this.fileSystem.readDirectory(bibleCacheDirectory);
    } catch {
      return [];
    }

    const records: BibleCandidateRecord[] = [];

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.json')) {
        continue;
      }

      try {
        records.push(
          await readBibleCandidateFile(joinStoryPath(bibleCacheDirectory, name), this.fileSystem),
        );
      } catch {
        // NOTE: Invalid cache records are excluded from candidate promotion.
      }
    }

    return records;
  }

  public async saveCanon(workspaceRoot: StoryUri, canon: StoryBible): Promise<void> {
    const { bibleCanon, bibleDirectory } = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(bibleDirectory);
    await writeBibleFile(bibleCanon, this.fileSystem, canon);
  }
}
