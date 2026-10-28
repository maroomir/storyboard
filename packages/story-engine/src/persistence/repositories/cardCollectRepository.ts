import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import {
  type StoryUri,
  parseDraft,
  readDraftFile,
  getStoryboardProjectPaths,
  type Draft,
  type CharacterRef,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { loadCharacterRoster } from '#engine/persistence/relationGraphData';
import type { CollectDraft } from '#engine/ai/cardCollectBuilder';
import type { ICardCollectRepository } from '#engine/application/cards/cardRepositories';

export class CardCollectRepository implements ICardCollectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CharacterRef[]> {
    return await loadCharacterRoster(this.fileSystem, workspaceRoot);
  }

  public async loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]> {
    const { draftDirectory } = getStoryboardProjectPaths(workspaceRoot);

    return await new WorkspaceFiles(this.fileSystem).readAll(draftDirectory, {
      isEligible: (name) => name.endsWith('.md'),
      read: async (uri): Promise<CollectDraft> => {
        const draft: Draft = parseDraft(await readDraftFile(uri, this.fileSystem));
        return { body: draft.body, sceneStem: draft.sceneStem };
      },
    });
  }
}
