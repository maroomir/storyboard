import { type StoryUri, parseDraft, readDraftFile } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { readDirectoryFiles } from '#engine/persistence/directoryFiles';
import type { ICardCollectRepository } from '#engine/application/cards/collectCardProposalsUseCase';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { loadCharacterRoster } from '#engine/persistence/relationGraphData';
import type { CollectDraft, CollectRosterEntry } from '#engine/ai/cardCollectBuilder';

export class CardCollectRepository implements ICardCollectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadCharacterRoster(
    workspaceRoot: StoryUri,
  ): Promise<readonly CollectRosterEntry[]> {
    return await loadCharacterRoster(this.fileSystem, workspaceRoot);
  }

  public async loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]> {
    const { draftDirectory } = getStoryboardProjectPaths(workspaceRoot);

    // NOTE: Invalid drafts are excluded from collection proposals.
    return await readDirectoryFiles(this.fileSystem, draftDirectory, {
      isEligible: (name) => name.endsWith('.md'),
      read: async (uri): Promise<CollectDraft> => {
        const draft = parseDraft(await readDraftFile(uri, this.fileSystem));
        return { body: draft.body, sceneStem: draft.sceneStem };
      },
    });
  }
}
