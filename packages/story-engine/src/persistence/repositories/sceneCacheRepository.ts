import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneCacheRepository } from '#engine/application/drafts/draftRepositories';
import {
  readSceneCacheFile,
  type SceneCacheRecord,
  writeSceneCacheFile,
} from '#engine/domain/files/sceneCache';

export class SceneCacheRepository implements ISceneCacheRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri): Promise<SceneCacheRecord> {
    return await readSceneCacheFile(uri, this.fileSystem);
  }

  public async write(uri: StoryUri, record: SceneCacheRecord): Promise<void> {
    await writeSceneCacheFile(uri, this.fileSystem, record);
  }

  public async ensureDirectory(uri: StoryUri): Promise<void> {
    await this.fileSystem.createDirectory(uri);
  }
}
