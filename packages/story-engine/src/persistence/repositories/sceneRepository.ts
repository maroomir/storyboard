import type { StoryUri, SceneBeat, SceneFile } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneRepository } from '#engine/application/drafts/draftRepositories';
import { applySceneBeats, readSceneFile } from '@storyboard/story-model';
export class SceneRepository implements ISceneRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri, fileName: string): Promise<SceneFile> {
    return await readSceneFile(uri, this.fileSystem, fileName);
  }

  public async writeBeats(uri: StoryUri, beats: readonly SceneBeat[]): Promise<void> {
    await this.rewriteScene(uri, (rawScene) => applySceneBeats(rawScene, beats));
  }

  private async rewriteScene(uri: StoryUri, rewrite: (rawScene: string) => string): Promise<void> {
    const rawScene: string = new TextDecoder().decode(await this.fileSystem.readFile(uri));
    const rewritten: string = rewrite(rawScene);

    if (rewritten !== rawScene) {
      await this.fileSystem.writeFile(uri, new TextEncoder().encode(rewritten));
    }
  }
}
