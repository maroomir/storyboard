import type { HostAdapters } from '#engine/application/engineServices';
import { draftPath, type StoryUri } from '@storyboard/story-model';

import { DraftRevisionStore } from '#engine/persistence/cache/draftRevisionStore';

function relativePathOf(workspaceRoot: StoryUri, uri: StoryUri): string {
  return uri.path.startsWith(`${workspaceRoot.path}/`)
    ? uri.path.slice(workspaceRoot.path.length + 1)
    : uri.path;
}

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
    draftUri: StoryUri = draftPath(workspaceRoot, sceneStem),
  ): Promise<string | undefined> {
    return this.shouldArchive('per-setting')
      ? await this.archive(workspaceRoot, sceneStem, draftUri)
      : undefined;
  }

  public async archive(
    workspaceRoot: StoryUri,
    sceneStem: string,
    draftUri: StoryUri = draftPath(workspaceRoot, sceneStem),
  ): Promise<string | undefined> {
    const sceneId: string | undefined = await this.findSceneId(workspaceRoot, sceneStem);
    if (sceneId === undefined) {
      return undefined;
    }

    return await this.revisions(workspaceRoot).keepBeforeOverwrite(
      sceneId,
      relativePathOf(workspaceRoot, draftUri),
    );
  }

  public async listRevisions(workspaceRoot: StoryUri, sceneStem: string): Promise<readonly string[]> {
    const sceneId: string | undefined = await this.findSceneId(workspaceRoot, sceneStem);
    return sceneId === undefined ? [] : await this.revisions(workspaceRoot).list(sceneId);
  }

  private async findSceneId(workspaceRoot: StoryUri, sceneStem: string): Promise<string | undefined> {
    return (await this.host.scenes.find(workspaceRoot, sceneStem))?.content.header.id;
  }

  private revisions(workspaceRoot: StoryUri): DraftRevisionStore {
    return new DraftRevisionStore({ fileSystem: this.host.fileSystem, workspaceRoot });
  }
}
