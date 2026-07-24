import type { IFileSystem } from '../../../application/ports/fileSystem';
import type { ISceneRepository } from '../../../application/ports/repositories';
import { readSceneFile } from '@storyboard/story-format';
import type { SceneFile } from '@storyboard/story-format';
export class SceneRepository implements ISceneRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: unknown, fileName: string): Promise<SceneFile> {
    return await readSceneFile(uri, this.fileSystem, fileName);
  }
}
