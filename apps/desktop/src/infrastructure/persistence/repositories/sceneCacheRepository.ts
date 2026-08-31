import type { IFileSystem } from '@storyboard/story-engine';
import type { ISceneCacheRepository } from '@storyboard/story-engine';
import {
  readSceneCacheFile,
  writeSceneCacheFile,
  type SceneCacheRecord,
} from '@storyboard/story-engine';

export class SceneCacheRepository implements ISceneCacheRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: unknown): Promise<SceneCacheRecord> {
    return await readSceneCacheFile(uri, this.fileSystem);
  }

  public async write(uri: unknown, record: SceneCacheRecord): Promise<void> {
    await writeSceneCacheFile(uri, this.fileSystem, record);
  }

  public async ensureDirectory(uri: unknown): Promise<void> {
    await this.fileSystem.createDirectory(uri);
  }
}
