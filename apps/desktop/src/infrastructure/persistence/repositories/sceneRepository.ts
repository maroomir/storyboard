import type { IFileSystem } from '../../../application/ports/fileSystem';
import type { ISceneRepository } from '../../../application/ports/repositories';
import { applySceneGrounding, readSceneFile } from '@storyboard/story-format';
import type { SceneFile, SceneGrounding } from '@storyboard/story-format';
export class SceneRepository implements ISceneRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: unknown, fileName: string): Promise<SceneFile> {
    return await readSceneFile(uri, this.fileSystem, fileName);
  }

  public async writeGrounding(uri: unknown, grounding: SceneGrounding): Promise<void> {
    const rawScene = new TextDecoder().decode(await this.fileSystem.readFile(uri));
    await this.fileSystem.writeFile(
      uri,
      new TextEncoder().encode(applySceneGrounding(rawScene, grounding)),
    );
  }
}
