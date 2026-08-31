import { joinStoryPath, type StoryUri } from '../../paths/storyUri';
import type { FileSystemDirectoryEntry, IFileSystem } from '../../ports/fileSystem';
import type { ICardCollectRepository } from '../../application/cards/collectCardProposalsUseCase';
import { getStoryboardProjectPaths } from '../../paths/projectPaths';
import { loadCharacterRoster } from '../relationGraphData';
import { parseDraft, readDraftFile } from '@storyboard/story-format';
import type { DraftFileSystem } from '@storyboard/story-format';
import type { CollectDraft, CollectRosterEntry } from '../../ai/cardCollectBuilder';

export class CardCollectRepository implements ICardCollectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadCharacterRoster(
    workspaceRoot: StoryUri,
  ): Promise<readonly CollectRosterEntry[]> {
    return await loadCharacterRoster(this.fileSystem, workspaceRoot);
  }

  public async loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]> {
    const { draftDirectory } = getStoryboardProjectPaths(workspaceRoot);
    let entries: FileSystemDirectoryEntry[];

    try {
      entries = await this.fileSystem.readDirectory(draftDirectory);
    } catch {
      return [];
    }

    const drafts: CollectDraft[] = [];

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.md')) {
        continue;
      }

      try {
        const raw = await readDraftFile(joinStoryPath(draftDirectory, name), this.fileSystem);
        const draft = parseDraft(raw);
        drafts.push({ body: draft.body, sceneStem: draft.sceneStem });
      } catch {
        // NOTE: Invalid drafts are excluded from collection proposals.
      }
    }

    return drafts;
  }
}
