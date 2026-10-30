import type { HostAdapters } from '#engine/application/engineServices';
import {
  archiveExistingDraft,
  draftHistorySceneDirectory,
  draftPath,
  joinUri,
  type StoryUri,
} from '@storyboard/story-model';

export type DraftArchivePolicy = 'per-setting' | 'always' | 'never';

export class DraftHistoryArchiver {
  public constructor(private readonly host: HostAdapters) {}

  public shouldArchive(policy: DraftArchivePolicy): boolean {
    if (policy === 'per-setting') {
      return this.host.configBridge.isKeepDraftHistoryEnabled();
    }

    return policy === 'always';
  }

  public async archiveWhenHistoryIsKept(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<string | undefined> {
    return this.shouldArchive('per-setting')
      ? await this.archive(workspaceRoot, sceneStem)
      : undefined;
  }

  public async archive(workspaceRoot: StoryUri, sceneStem: string): Promise<string | undefined> {
    const historyDirectory: StoryUri = draftHistorySceneDirectory(workspaceRoot, sceneStem);

    return await archiveExistingDraft({
      draftUri: draftPath(workspaceRoot, sceneStem),
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: this.host.fileSystem,
    });
  }
}
