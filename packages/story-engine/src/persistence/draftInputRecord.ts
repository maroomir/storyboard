import type { SceneCacheRecord, SceneStoryState, StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneCacheRepository } from '#engine/application/drafts/draftRepositories';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export interface DraftInputRecordDependencies {
  readonly fileSystem: IFileSystem;
  readonly scenes: WorkspaceScenes;
  readonly sceneCache: ISceneCacheRepository;
}

export interface DraftInputLocation {
  readonly workspaceRoot: StoryUri;
  readonly stem: string;
  readonly cacheUri: StoryUri;
}

export class DraftInputRecord {
  public constructor(private readonly dependencies: DraftInputRecordDependencies) {}

  public async readRecordedHash(location: DraftInputLocation): Promise<string | undefined> {
    const hasCacheRecord: boolean = await this.dependencies.fileSystem.exists(location.cacheUri);

    return hasCacheRecord
      ? await this.readCachedHash(location.cacheUri)
      : await this.readLedgerHash(location);
  }

  private async readCachedHash(cacheUri: StoryUri): Promise<string | undefined> {
    try {
      const record: SceneCacheRecord = await this.dependencies.sceneCache.read(cacheUri);
      return record.inputHash;
    } catch {
      return undefined;
    }
  }

  private async readLedgerHash(location: DraftInputLocation): Promise<string | undefined> {
    const state: SceneStoryState | undefined = await this.dependencies.scenes.readState(
      location.workspaceRoot,
      location.stem,
    );
    return state?.inputHash;
  }
}
