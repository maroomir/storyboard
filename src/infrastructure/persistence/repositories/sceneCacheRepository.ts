import type { IFileSystem } from '../../../application/ports/fileSystem';
import type { ISceneCacheRepository } from '../../../application/ports/repositories';
import {
  readSceneCacheFile,
  writeSceneCacheFile,
  type SceneCacheRecord,
} from '../../../files/sceneCache';

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
